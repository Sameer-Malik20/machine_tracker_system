import { NextRequest, NextResponse } from "next/server";
import { verifyToken, hashPassword } from "@/lib/auth";
import User from "@/lib/models/User";
import connectDB from "@/lib/db";

export const dynamic = "force-dynamic";

function getAuthenticatedSuperAdmin(req: NextRequest) {
  const token =
    req.cookies.get("__Host-wfh-session")?.value ||
    req.cookies.get("wfh-session")?.value;

  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== "super_admin") return null;

  return decoded;
}

export async function GET(req: NextRequest) {
  const admin = getAuthenticatedSuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden. Super admin access only." }, { status: 403 });
  }

  try {
    await connectDB();
    const users = await User.find({ role: "admin" }).select("-passwordHash").sort({ createdAt: -1 });
    return NextResponse.json(users);
  } catch (error) {
    console.error("[API - Users GET Error] Failed to list users:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = getAuthenticatedSuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden. Super admin access only." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, password, assignedMachines } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Password strength check
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters long" }, { status: 400 });
    }

    await connectDB();

    // Check if user already exists
    const emailLower = email.toLowerCase().trim();
    const existing = await User.findOne({ email: emailLower });
    if (existing) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const newUser = await User.create({
      email: emailLower,
      passwordHash,
      role: "admin",
      assignedMachines: Array.isArray(assignedMachines) ? assignedMachines : [],
    });

    const userObj = newUser.toObject();
    delete userObj.passwordHash;

    return NextResponse.json({ success: true, user: userObj }, { status: 201 });
  } catch (error) {
    console.error("[API - Users POST Error] Failed to create user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
