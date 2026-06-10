import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token =
    req.cookies.get("__Host-wfh-session")?.value ||
    req.cookies.get("wfh-session")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      email: decoded.email,
      role: decoded.role,
    },
  });
}
