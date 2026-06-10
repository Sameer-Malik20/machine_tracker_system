import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
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

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = getAuthenticatedSuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden. Super admin access only." }, { status: 403 });
  }

  const { id } = params;

  try {
    const body = await req.json();
    const { assignedMachines } = body;

    if (!Array.isArray(assignedMachines)) {
      return NextResponse.json({ error: "assignedMachines must be an array of strings" }, { status: 400 });
    }

    await connectDB();
    const user = await User.findById(id);

    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
    }

    user.assignedMachines = assignedMachines;
    await user.save();

    const updatedObj = user.toObject();
    delete updatedObj.passwordHash;

    return NextResponse.json({ success: true, user: updatedObj });
  } catch (error) {
    console.error("[API - User PUT Error] Failed to update user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = getAuthenticatedSuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden. Super admin access only." }, { status: 403 });
  }

  const { id } = params;

  try {
    await connectDB();
    const user = await User.findById(id);

    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
    }

    await User.deleteOne({ _id: id });
    return NextResponse.json({ success: true, message: "Admin user deleted successfully" });
  } catch (error) {
    console.error("[API - User DELETE Error] Failed to delete user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
