import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { DatabaseSimulator, OsqueryLogEntry, OsqueryPayload } from "@/lib/db";
import { ActivityTracker } from "@/lib/activityTracker";

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

    // Force re-enrollment if the node key is not recognized in memory (e.g. server restarted)
    if (!ActivityTracker.hasNode(nodeKey)) {
      console.warn(`[API - Log] Unrecognized node key: ${nodeKey}. Triggering re-enrollment.`);
      return NextResponse.json({ node_invalid: true }, { status: 200 });
    }

    // Parse status vs result logs. We are tracking client activity using result logs.
    if (logType === "status") {
      console.info(`[API - Log] Received status log from ${nodeKey}`);
      // Register heartbeat from status query
      ActivityTracker.processLogCheckin(nodeKey, "status_log", logs.length);
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

    // Process activity calculations (e.g. process query tracker)
    // Osquery submits telemetry results periodically. We track these intervals.
    if (validLogs.length > 0) {
      ActivityTracker.processLogCheckinWithLogs(nodeKey, validLogs, hostIdentifier);
    } else {
      // Log checkin without logs (empty list is sent by client when no diff changes occur)
      ActivityTracker.processLogCheckinWithLogs(nodeKey, [], hostIdentifier);
    }

    // Asynchronously dispatch database insertions to keep Next.js execution thread unblocked and super-fast
    const payload: OsqueryPayload = { node_key: nodeKey, log_type: logType, data: validLogs };
    
    // Non-blocking invocation
    DatabaseSimulator.persistLogs(payload).catch((err) => {
      console.error(`[API - Log] Asynchronous db write failure for node ${nodeKey}:`, err);
    });

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
