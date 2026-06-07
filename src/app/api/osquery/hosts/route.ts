import { NextResponse } from "next/server";
import { ActivityTracker } from "@/lib/activityTracker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const registry = ActivityTracker.getActiveRegistry();
    return NextResponse.json(registry);
  } catch (error) {
    console.error("Failed to fetch host registry:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
