import { NextRequest, NextResponse } from "next/server";
import { ActivityTracker } from "@/lib/activityTracker";
import { verifyToken } from "@/lib/auth";
import User from "@/lib/models/User";
import connectDB from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token =
    req.cookies.get("__Host-wfh-session")?.value ||
    req.cookies.get("wfh-session")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized. Session required." }, { status: 401 });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  try {
    const registry = ActivityTracker.getActiveRegistry();

    // Super admin has visibility to all enrolled endpoints
    if (decoded.role === "super_admin") {
      return NextResponse.json(registry);
    }

    // Standard admin has visibility restricted to assigned machines
    await connectDB();
    const user = await User.findById(decoded.userId);
    if (!user) {
      return NextResponse.json({ error: "Admin user profile not found" }, { status: 404 });
    }

    const assigned = user.assignedMachines || [];
    
    // Filter hosts to show only assigned ones (checking match against either nodeKey or hostname)
    const filteredRegistry = registry.filter(
      (host) => assigned.includes(host.nodeKey) || assigned.includes(host.hostname)
    );

    return NextResponse.json(filteredRegistry);
  } catch (error) {
    console.error("Failed to fetch host registry with RBAC:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
