import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import connectDB from "@/lib/db";
import MachineLog from "@/lib/models/MachineLog";
import EnrolledNode from "@/lib/models/EnrolledNode";
import { SettingsManager } from "@/lib/settings";
import { ActivityTracker } from "@/lib/activityTracker";

export const dynamic = "force-dynamic";

interface StateTransition {
  status: "Active" | "Idle" | "Offline";
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
}

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

  const { searchParams } = new URL(req.url);
  const nodeKey = searchParams.get("nodeKey");
  const dateStr = searchParams.get("date"); // YYYY-MM-DD
  const tzOffsetStr = searchParams.get("tzOffset");
  const tzOffset = tzOffsetStr ? parseInt(tzOffsetStr, 10) : 0; // in minutes

  if (!nodeKey || !dateStr) {
    return NextResponse.json({ error: "Missing nodeKey or date parameter." }, { status: 400 });
  }

  try {
    await connectDB();

    const node = await EnrolledNode.findOne({ nodeKey });
    if (!node) {
      return NextResponse.json({ error: "Node not found." }, { status: 404 });
    }

    const startOfDay = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + tzOffset * 60 * 1000);
    const endOfDay = new Date(new Date(`${dateStr}T23:59:59.999Z`).getTime() + tzOffset * 60 * 1000);

    const settings = await SettingsManager.getSettings();
    const platformSettings = node.platform === "darwin" ? settings.mac : settings.windows;
    const intervalSecs = platformSettings.activityInterval || 60;
    const offlineThreshold = Math.max(120, intervalSecs * 2.0);

    // Fetch system info / specs for that day (latest before or on that day)
    const perfLog = await MachineLog.findOne({
      nodeKey,
      name: "system_performance",
      timestamp: { $lte: endOfDay }
    }).sort({ timestamp: -1 });

    const systemInfo = perfLog ? [perfLog.columns] : [];

    // Reconstruct running processes at the end of the day or latest checkin on that day
    const latestProcSnapshot = await MachineLog.findOne({
      nodeKey,
      name: "running_processes",
      action: "snapshot",
      timestamp: { $lte: endOfDay }
    }).sort({ timestamp: -1 });

    let processesList: Record<string, string>[] = [];
    if (latestProcSnapshot) {
      const snapshotRows = await MachineLog.find({
        nodeKey,
        name: "running_processes",
        timestamp: latestProcSnapshot.timestamp
      });
      processesList = snapshotRows.map(r => r.columns);

      const increments = await MachineLog.find({
        nodeKey,
        name: "running_processes",
        action: { $in: ["added", "removed"] },
        timestamp: { $gt: latestProcSnapshot.timestamp, $lte: endOfDay }
      }).sort({ timestamp: 1 });

      for (const inc of increments) {
        const cols = inc.columns;
        const index = processesList.findIndex(p => p.pid === cols.pid);
        if (inc.action === "added") {
          if (index > -1) processesList[index] = cols;
          else processesList.push(cols);
        } else if (inc.action === "removed") {
          if (index > -1) processesList.splice(index, 1);
        }
      }
    } else {
      // Replay all logs up to endOfDay
      const procLogs = await MachineLog.find({
        nodeKey,
        name: "running_processes",
        timestamp: { $lte: endOfDay }
      }).sort({ timestamp: 1 });

      for (const log of procLogs) {
        const cols = log.columns;
        const index = processesList.findIndex(p => p.pid === cols.pid);
        if (log.action === "snapshot") {
          processesList = [cols];
        } else if (log.action === "added") {
          if (index > -1) processesList[index] = cols;
          else processesList.push(cols);
        } else if (log.action === "removed") {
          if (index > -1) processesList.splice(index, 1);
        }
      }
    }

    // Reconstruct network sockets
    const latestSockSnapshot = await MachineLog.findOne({
      nodeKey,
      name: "active_network_sockets",
      action: "snapshot",
      timestamp: { $lte: endOfDay }
    }).sort({ timestamp: -1 });

    let socketsList: Record<string, string>[] = [];
    if (latestSockSnapshot) {
      const snapshotRows = await MachineLog.find({
        nodeKey,
        name: "active_network_sockets",
        timestamp: latestSockSnapshot.timestamp
      });
      socketsList = snapshotRows.map(r => r.columns);

      const increments = await MachineLog.find({
        nodeKey,
        name: "active_network_sockets",
        action: { $in: ["added", "removed"] },
        timestamp: { $gt: latestSockSnapshot.timestamp, $lte: endOfDay }
      }).sort({ timestamp: 1 });

      for (const inc of increments) {
        const cols = inc.columns;
        const index = socketsList.findIndex(s =>
          s.pid === cols.pid &&
          s.local_port === cols.local_port &&
          s.remote_port === cols.remote_port
        );
        if (inc.action === "added") {
          if (index > -1) socketsList[index] = cols;
          else socketsList.push(cols);
        } else if (inc.action === "removed") {
          if (index > -1) socketsList.splice(index, 1);
        }
      }
    } else {
      const sockLogs = await MachineLog.find({
        nodeKey,
        name: "active_network_sockets",
        timestamp: { $lte: endOfDay }
      }).sort({ timestamp: 1 });

      for (const log of sockLogs) {
        const cols = log.columns;
        const index = socketsList.findIndex(s =>
          s.pid === cols.pid &&
          s.local_port === cols.local_port &&
          s.remote_port === cols.remote_port
        );
        if (log.action === "snapshot") {
          socketsList = [cols];
        } else if (log.action === "added") {
          if (index > -1) socketsList[index] = cols;
          else socketsList.push(cols);
        } else if (log.action === "removed") {
          if (index > -1) socketsList.splice(index, 1);
        }
      }
    }

    // Fetch window history logs on that day
    const windowHistoryLogs = await MachineLog.find({
      nodeKey,
      name: "window_history",
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 });
    const windowHistory = windowHistoryLogs.map(r => r.columns);

    // Fetch chrome history on that day
    const chromeHistoryLogs = await MachineLog.find({
      nodeKey,
      name: "chrome_history",
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 });
    const chromeHistory = chromeHistoryLogs.map(r => r.columns);

    // Fetch edge history on that day
    const edgeHistoryLogs = await MachineLog.find({
      nodeKey,
      name: "edge_history",
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 });
    const edgeHistory = edgeHistoryLogs.map(r => r.columns);

    // Reconstruct user activity (keyboard/mouse) for the end of the day or latest on that day
    const latestUserActivityLog = await MachineLog.findOne({
      nodeKey,
      name: "user_activity",
      timestamp: { $lte: endOfDay }
    }).sort({ timestamp: -1 });

    let userActivity: Record<string, string>[] = [];
    if (latestUserActivityLog) {
      const activityRows = await MachineLog.find({
        nodeKey,
        name: "user_activity",
        timestamp: latestUserActivityLog.timestamp
      });
      userActivity = activityRows.map(r => r.columns);
    }

    // Fetch check-in logs (recentQueries) for that day
    const checkinLogs = await MachineLog.find({
      nodeKey,
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 }).limit(100);

    const recentQueries = checkinLogs.map(r => ({
      queryName: r.name,
      timestamp: r.timestamp.toISOString(),
      rowCount: 1 // fallback count
    }));

    // Reconstruct status transitions history for the work timeline
    const statusLogs = await MachineLog.find({
      nodeKey,
      name: "user_activity",
      "columns.name": "ActiveStatus",
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: 1 });

    const checkins = statusLogs.map(log => ({
      timestamp: log.timestamp,
      status: log.columns.data === "Idle" ? "Idle" as const : "Active" as const
    }));

    const statusHistory = ActivityTracker.reconstructStatusHistory(
      checkins,
      startOfDay,
      endOfDay,
      intervalSecs,
      offlineThreshold
    );

    // Fetch latest completeness debug details on that day
    const debugLog = await MachineLog.findOne({
      nodeKey,
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 });

    return NextResponse.json({
      nodeKey,
      hostname: node.hostname,
      platform: node.platform,
      latestResults: {
        running_processes: processesList,
        active_network_sockets: socketsList,
        system_performance: systemInfo,
        user_activity: userActivity,
        window_history: windowHistory,
        chrome_history: chromeHistory,
        edge_history: edgeHistory
      },
      recentQueries,
      statusHistory,
      lastHeartbeat: debugLog ? debugLog.timestamp.toISOString() : startOfDay.toISOString()
    });
  } catch (error) {
    console.error("Failed to fetch historical node telemetry:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ReconstructStatusHistory logic moved to ActivityTracker.reconstructStatusHistory static method
