import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { DatabaseSimulator, OsqueryLogEntry, OsqueryPayload } from "@/lib/db";
import { ActivityTracker, activityRegistry } from "@/lib/activityTracker";
import { SettingsManager } from "@/lib/settings";
import { connectDB } from "@/lib/db";
import EnrolledNode from "@/lib/models/EnrolledNode";

// Set compile configurations
export const dynamic = "force-dynamic";

interface RawOsqueryLogEntry {
  name?: string;
  action?: string;
  columns?: Record<string, string>;
  snapshot?: Record<string, string>[];
  timestamp?: string;
}

/**
 * Handle Osquery's logger requests.
 * Osquery TLS Logger protocol sends logs in batches:
 * Body format: { "node_key": "...", "log_type": "result" | "status", "data": [ ... ] }
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    // Support both wrapper objects and raw arrays for extreme robustness
    let nodeKey: string | null = null;
    let logType: "result" | "status" = "result";
    let logs: RawOsqueryLogEntry[] = [];
    let hostIdentifier: string | null = null;

    if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
      nodeKey = rawBody.node_key || req.headers.get(CONFIG.NODE_KEY_HEADER);
      logType = rawBody.log_type || "result";
      logs = Array.isArray(rawBody.data) ? rawBody.data : [];
      hostIdentifier = rawBody.host_identifier || rawBody.hostIdentifier || null;
    } else if (Array.isArray(rawBody)) {
      nodeKey = req.headers.get(CONFIG.NODE_KEY_HEADER);
      logs = rawBody;
    }

    // Security check: validate node key is enrolled
    if (!nodeKey || !nodeKey.startsWith(CONFIG.MOCK_NODE_KEY_PREFIX)) {
      console.warn(`[API - Log] Unauthorized log submission. Invalid node key: ${nodeKey}`);
      return NextResponse.json({ node_invalid: true }, { status: 200 });
    }

    // Force re-enrollment if the node key is not recognized in memory — but first try DB restore
    if (!ActivityTracker.hasNode(nodeKey)) {
      let restored = false;
      try {
        await connectDB();
        const persisted = await EnrolledNode.findOne({ nodeKey });
        if (persisted) {
          ActivityTracker.registerNode(nodeKey, persisted.hostname, persisted.platform);
          restored = true;
        }
      } catch (_) { }
      if (!restored) {
        console.warn(`[API - Log] Unrecognized node key: ${nodeKey}. Triggering re-enrollment.`);
        return NextResponse.json({ node_invalid: true }, { status: 200 });
      }
    }

    // Fetch settings to check configured log arrival frequency
    const settings = await SettingsManager.getSettings();
    const intervalSecs = (settings.logIntervalMinutes || 10) * 60;

    // Parse status vs result logs. We are tracking client activity using result logs.
    if (logType === "status") {
      console.info(`[API - Log] Received status log from ${nodeKey}`);
      // Register heartbeat from status query
      ActivityTracker.processLogCheckin(nodeKey, "status_log", logs.length, intervalSecs);
      return NextResponse.json({ node_invalid: false });
    }

    // Safety check: input length validation (prevent memory crash with massive log dumps)
    if (logs.length > 5000) {
      console.warn(`[API - Log] Payload exceeds maximum batch size (5000 items). Node: ${nodeKey}`);
      return NextResponse.json({ error: "Payload too large", node_invalid: false }, { status: 400 });
    }

    // Perform strict type and value checks on each log entry (data validation layer)
    const validLogs: OsqueryLogEntry[] = [];
    for (const entry of logs) {
      if (entry && typeof entry === "object" && typeof entry.name === "string") {
        if (entry.action === "snapshot" && Array.isArray(entry.snapshot)) {
          // Normalize snapshot rows
          for (const row of entry.snapshot) {
            if (row && typeof row === "object") {
              const sanitizedColumns: Record<string, string> = {};
              for (const [key, value] of Object.entries(row)) {
                if (typeof key === "string" && typeof value === "string") {
                  sanitizedColumns[key.trim()] = value.trim();
                }
              }
              validLogs.push({
                name: entry.name.trim(),
                action: "snapshot",
                columns: sanitizedColumns,
                timestamp: typeof entry.timestamp === "string" ? entry.timestamp : String(Date.now() / 1000)
              });
            }
          }
        } else if (
          (entry.action === "added" || entry.action === "removed" || entry.action === "snapshot") &&
          entry.columns &&
          typeof entry.columns === "object"
        ) {
          const sanitizedColumns: Record<string, string> = {};
          for (const [key, value] of Object.entries(entry.columns)) {
            if (typeof key === "string" && typeof value === "string") {
              sanitizedColumns[key.trim()] = value.trim();
            }
          }
          validLogs.push({
            name: entry.name.trim(),
            action: entry.action,
            columns: sanitizedColumns,
            timestamp: typeof entry.timestamp === "string" ? entry.timestamp : String(Date.now() / 1000)
          });
        }
      }
    }

    const hostState = activityRegistry.get(nodeKey);
    const now = new Date();

    // Custom console debug logging requested by user to inspect dynamic intervals and completeness
    const hostname = hostState?.hostname || hostIdentifier || "unknown_host";
    const platform = hostState?.platform || "unknown";
    const timeSinceLastHeartbeat = hostState?.lastHeartbeat
      ? `${Math.round((now.getTime() - hostState.lastHeartbeat.getTime()) / 1000)}s`
      : "N/A (First heartbeat)";
    const timeSinceLastLogSave = hostState?.lastLogSaveTime
      ? `${Math.round((now.getTime() - hostState.lastLogSaveTime.getTime()) / 1000)}s`
      : "N/A (First log save)";

    const EXPECTED_QUERIES = [
      "running_processes",
      "system_performance",
      "active_network_sockets",
      "user_activity",
      "chrome_history",
      "edge_history",
      "window_history",
      "active_window"
    ];

    const incomingQueryCounts: Record<string, number> = {};
    for (const entry of validLogs) {
      incomingQueryCounts[entry.name] = (incomingQueryCounts[entry.name] || 0) + 1;
    }

    const receivedQueries = Object.keys(incomingQueryCounts);
    const missingQueries = EXPECTED_QUERIES.filter(q => !incomingQueryCounts[q]);
    const completeness = missingQueries.length === 0
      ? "PROPER / COMPLETE (All expected telemetry queries present)"
      : `PARTIAL (Missing expected queries: ${missingQueries.join(", ")})`;

    console.log(`
================================================================================
[DEBUG - TELEMETRY ARRIVAL]
Host: ${hostname} (Node Key: ${nodeKey}, Platform: ${platform})
Selected Logs Arrival Frequency: ${settings.logIntervalMinutes}m (${intervalSecs}s)

Time Elapsed:
- Since last check-in: ${timeSinceLastHeartbeat} (Expected ~${intervalSecs}s)
- Since last DB log save: ${timeSinceLastLogSave} (Expected ~${intervalSecs}s)

Received Queries Breakdown in Payload:
${receivedQueries.length > 0
        ? receivedQueries.map(q => `  * ${q}: ${incomingQueryCounts[q]} rows`).join("\n")
        : "  (None)"}

Completeness Assessment: ${completeness}
================================================================================
`);

    if (hostState && !hostState.lastQuerySaveTimes) {
      hostState.lastQuerySaveTimes = {};
    }

    // Helper to get capture timestamp of logs in milliseconds
    const getEntryTimeMs = (entry: OsqueryLogEntry): number => {
      if (entry.timestamp) {
        const sec = parseFloat(entry.timestamp);
        if (!isNaN(sec)) {
          return sec < 2000000000 ? sec * 1000 : sec;
        }
        const parsed = new Date(entry.timestamp);
        if (!isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
      }
      return Date.now();
    };

    // Filter validLogs to only include logs for queries that haven't been saved recently
    const logsToSave: OsqueryLogEntry[] = [];
    const queriesToUpdate: string[] = [];
    let rateLimitedCount = 0;
    const batchMaxEntryTimes: Record<string, Date> = {};

    for (const entry of validLogs) {
      const queryName = entry.name;
      const entryTimeMs = getEntryTimeMs(entry);
      const lastSaveDate = hostState?.lastQuerySaveTimes?.[queryName];
      let shouldRateLimitQuery = false;

      if (lastSaveDate) {
        const lastSaveTimeMs = lastSaveDate.getTime();
        const elapsed = Math.abs(entryTimeMs - lastSaveTimeMs) / 1000;
        if (elapsed < intervalSecs - 5) {
          shouldRateLimitQuery = true;
        }
      }

      if (!shouldRateLimitQuery) {
        logsToSave.push(entry);
        if (!queriesToUpdate.includes(queryName)) {
          queriesToUpdate.push(queryName);
        }

        const entryDate = new Date(entryTimeMs);
        if (!batchMaxEntryTimes[queryName] || entryTimeMs > batchMaxEntryTimes[queryName].getTime()) {
          batchMaxEntryTimes[queryName] = entryDate;
        }
      } else {
        rateLimitedCount++;
      }
    }

    if (rateLimitedCount > 0) {
      console.log(`[API - Log] Rate-limiting DB save: dropped ${rateLimitedCount} rows for queries that arrived too early.`);
    }

    const processedState = ActivityTracker.processLogCheckinWithLogs(nodeKey, logsToSave, hostIdentifier, intervalSecs);

    if (processedState) {
      processedState.latestCheckinDebug = {
        selectedFrequencyMinutes: settings.logIntervalMinutes || 10,
        selectedFrequencySeconds: intervalSecs,
        timeSinceLastCheckinSeconds: timeSinceLastHeartbeat,
        timeSinceLastSaveSeconds: timeSinceLastLogSave,
        receivedQueriesBreakdown: incomingQueryCounts,
        missingQueries: missingQueries,
        completeness: completeness,
        rateLimitedDroppedCount: rateLimitedCount,
        timestamp: now
      };
    }

    if (logsToSave.length > 0) {
      if (processedState) {
        if (!processedState.lastQuerySaveTimes) {
          processedState.lastQuerySaveTimes = {};
        }
        for (const queryName of queriesToUpdate) {
          if (batchMaxEntryTimes[queryName]) {
            processedState.lastQuerySaveTimes[queryName] = batchMaxEntryTimes[queryName];
          } else {
            processedState.lastQuerySaveTimes[queryName] = now;
          }
        }
        processedState.lastLogSaveTime = now;
      }

      const payload: OsqueryPayload = { node_key: nodeKey, log_type: logType, data: logsToSave };
      // Non-blocking invocation
      DatabaseSimulator.persistLogs(payload).catch((err) => {
        console.error(`[API - Log] Asynchronous db write failure for node ${nodeKey}:`, err);
      });
    }

    // Return response required by Osquery TLS specification
    return NextResponse.json({
      node_invalid: false
    });
  } catch (error) {
    console.error(`[API - Log] Internal error:`, error);
    return NextResponse.json(
      { error: "Internal Server Error", node_invalid: true },
      { status: 500 }
    );
  }
}
