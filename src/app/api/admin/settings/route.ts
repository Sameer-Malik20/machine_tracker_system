import { NextRequest, NextResponse } from "next/server";
import { SettingsManager } from "@/lib/settings";
import { verifyToken } from "@/lib/auth";
import { activityRegistry } from "@/lib/activityTracker";
import MachineLog from "@/lib/models/MachineLog";
import connectDB from "@/lib/db";

export const dynamic = "force-dynamic";

function getAuthenticatedUser(req: NextRequest) {
  const token =
    req.cookies.get("__Host-wfh-session")?.value ||
    req.cookies.get("wfh-session")?.value;

  if (!token) return null;
  return verifyToken(token);
}

// Helper to run cleanups based on retention settings
async function runRetentionCleanup(retentionDays: number, action: "delete" | "archive") {
  try {
    await connectDB();
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    if (action === "delete") {
      const result = await MachineLog.deleteMany({
        timestamp: { $lt: cutoffDate },
      });
      console.log(`[Retention Job] Successfully deleted ${result.deletedCount} logs older than ${retentionDays} days.`);
    } else {
      const result = await MachineLog.updateMany(
        { timestamp: { $lt: cutoffDate }, archived: { $ne: true } },
        { $set: { archived: true, archivedAt: new Date() } }
      );
      console.log(`[Retention Job] Successfully archived ${result.modifiedCount} logs older than ${retentionDays} days.`);
    }
  } catch (err) {
    console.error("[Retention Job Error] Failed to process data cleanup:", err);
  }
}

export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await SettingsManager.getSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("[API - Admin Settings GET] Failed:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden. Super admin access only." }, { status: 403 });
  }

  try {
    const body = await req.json();
    
    if (!body || !body.windows || !body.mac) {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }

    // Process new settings
    await SettingsManager.saveSettings(body);

    // Reset all per-node rate-limit timestamps so new frequency applies immediately
    // This ensures that if admin changes from 10m → 1m, logs aren't blocked by old 10m timers
    const newIntervalMinutes = Number(body.logIntervalMinutes || 10);
    const newIntervalSecs = newIntervalMinutes * 60;
    
    for (const [, hostState] of activityRegistry) {
      hostState.lastQuerySaveTimes = {};
      hostState.lastLogSaveTime = undefined;
      if (hostState.latestCheckinDebug) {
        hostState.latestCheckinDebug.selectedFrequencyMinutes = newIntervalMinutes;
        hostState.latestCheckinDebug.selectedFrequencySeconds = newIntervalSecs;
      }
    }
    console.log(`[API - Admin Settings] Frequency changed to ${newIntervalMinutes}m. Rate-limit timers and debug states reset for all ${activityRegistry.size} nodes.`);

    // Trigger non-blocking retention cleanup asynchronously
    const dataRetentionDays = Number(body.dataRetentionDays || 30);
    const retentionAction = body.retentionAction || "archive";
    runRetentionCleanup(dataRetentionDays, retentionAction).catch(err => {
      console.error("[Retention Task] Asynchronous execution failed:", err);
    });

    return NextResponse.json({ success: true, settings: body });
  } catch (error) {
    console.error("[API - Admin Settings POST] Failed:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
