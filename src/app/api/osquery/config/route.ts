import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { ActivityTracker, activityRegistry } from "@/lib/activityTracker";
import { SettingsManager } from "@/lib/settings";
import { connectDB } from "@/lib/db";
import EnrolledNode from "@/lib/models/EnrolledNode";

// Set compile configurations
export const dynamic = "force-dynamic";

/**
 * Handle initial node enrollment or configuration fetching.
 * Osquery TLS API Protocols:
 * 1. Enrollment: Sends POST with { "enroll_secret": "...", "host_identifier": "..." }
 * 2. Configuration: Sends POST with { "node_key": "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if it's an enrollment request
    if (body.enroll_secret !== undefined) {
      if (body.enroll_secret !== CONFIG.ENROLL_SECRET) {
        console.warn(`[API - Config] Unauthorized enrollment attempt. Secret: ${body.enroll_secret}`);
        return NextResponse.json({ node_invalid: true }, { status: 200 });
      }

      // Successful enrollment: generate a secure, unique node key
      const hostId = body.host_identifier || "unknown_host";
      const platform = body.platform_type || body.host_details?.platform || "unknown";
      const nodeKey = `${CONFIG.MOCK_NODE_KEY_PREFIX}${Math.random().toString(36).substring(2, 15)}`;

      console.log(`[API - Config] Host successfully enrolled. ID: ${hostId}, Node Key: ${nodeKey}`);

      // Register the node in the activity tracker
      ActivityTracker.registerNode(nodeKey, hostId, platform);

      // Persist enrollment to MongoDB so it survives server restarts
      try {
        await connectDB();
        await EnrolledNode.findOneAndUpdate(
          { hostname: hostId },
          { nodeKey, hostname: hostId, platform, enrolledAt: new Date(), lastSeenAt: new Date() },
          { upsert: true, new: true }
        );
      } catch (dbErr) {
        console.warn(`[API - Config] Could not persist enrollment to DB:`, dbErr);
      }

      return NextResponse.json({
        node_key: nodeKey,
        node_invalid: false
      });
    }

    // Check if it's a configuration query request
    const nodeKey = body.node_key || req.headers.get(CONFIG.NODE_KEY_HEADER);

    if (!nodeKey || !nodeKey.startsWith(CONFIG.MOCK_NODE_KEY_PREFIX)) {
      console.warn(`[API - Config] Invalid or missing node key: ${nodeKey}`);
      return NextResponse.json({ node_invalid: true }, { status: 200 });
    }

    // If not in memory (e.g. server restarted), try to restore from MongoDB before forcing re-enrollment
    if (!ActivityTracker.hasNode(nodeKey)) {
      let restored = false;
      try {
        await connectDB();
        const persisted = await EnrolledNode.findOne({ nodeKey });
        if (persisted) {
          console.log(`[API - Config] Restoring node from DB: ${nodeKey} (${persisted.hostname})`);
          ActivityTracker.registerNode(nodeKey, persisted.hostname, persisted.platform);
          restored = true;
        }
      } catch (dbErr) {
        console.warn(`[API - Config] Could not restore node from DB:`, dbErr);
      }
      if (!restored) {
        console.warn(`[API - Config] Unrecognized node key: ${nodeKey}. Triggering re-enrollment.`);
        return NextResponse.json({ node_invalid: true }, { status: 200 });
      }
    }

    // Retrieve host from registry to check platform
    const host = ActivityTracker.hasNode(nodeKey) ? activityRegistry.get(nodeKey) : null;
    const platform = host ? host.platform : "windows";

    // Update check-in heartbeat for this node key
    ActivityTracker.registerNode(nodeKey, host?.hostname || `host_${nodeKey.substring(14, 20)}`, platform);

    // Update lastSeenAt in MongoDB (non-blocking)
    connectDB().then(() => EnrolledNode.findOneAndUpdate({ nodeKey }, { lastSeenAt: new Date() })).catch(() => { });

    console.log(`[API - Config] Config request received from node key: ${nodeKey} (Platform: ${platform})`);

    // Fetch dynamic admin-configured settings
    const settings = await SettingsManager.getSettings();
    const platformSettings = platform === "darwin" ? settings.mac : settings.windows;

    const processInterval = platformSettings.processInterval || 60;
    const performanceInterval = platformSettings.performanceInterval || 60;
    const networkInterval = platformSettings.networkInterval || 60;
    const activityInterval = platformSettings.activityInterval || 60;

    // Return the scheduled queries configuration (Osquery packs structure)
    const configResponse = {
      options: {
        config_tls_refresh: 60,
        logger_tls_period: 60,
      },
      schedule: {
        running_processes: {
          query: "SELECT name, pid, path, resident_size FROM processes;",
          interval: processInterval,
          description: "Tracks active applications and background processes currently running on the endpoint."
        },
        system_performance: {
          query: "SELECT hostname, cpu_brand, physical_memory, (SELECT name FROM os_version) as os_name, (SELECT platform FROM os_version) as os_platform FROM system_info;",
          interval: performanceInterval,
          snapshot: true,
          description: "Collects host hardware architecture and system specifications every 120 seconds."
        },
        active_network_sockets: {
          query: "SELECT pid, local_address, local_port, remote_address, remote_port, state FROM process_open_sockets;",
          interval: networkInterval,
          snapshot: true,
          description: "Collects active network sockets (established and listening ports) on the system."
        },
        user_activity: {
          query: "SELECT name, data FROM registry WHERE path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\ActiveStatus' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\IdleSeconds' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\LastInputTime' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\EmployeeName' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\EmployeeID' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\EmployeeEmail' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\Department';",
          interval: activityInterval,
          snapshot: true,
          description: "Tracks active user keyboard and mouse interaction telemetry from the Windows Registry."
        },
        chrome_history: {
          // Uses the ATC virtual table 'chrome_history_atc' defined below
          query: "SELECT url, title, last_visit_time FROM chrome_history_atc ORDER BY last_visit_time DESC LIMIT 20;",
          interval: activityInterval,
          snapshot: true,
          description: "Retrieves Chrome browser history from the copied SQLite database via ATC."
        },
        edge_history: {
          // Uses the ATC virtual table 'edge_history_atc' defined below
          query: "SELECT url, title, last_visit_time FROM edge_history_atc ORDER BY last_visit_time DESC LIMIT 20;",
          interval: activityInterval,
          snapshot: true,
          description: "Retrieves Edge browser history from the copied SQLite database via ATC."
        },
        window_history: {
          query: "SELECT name as timestamp, data as details FROM registry WHERE key LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\WindowHistory';",
          interval: activityInterval,
          snapshot: true,
          description: "Tracks active window foreground changes over time."
        },
        active_window: {
          query: "SELECT name, data FROM registry WHERE path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\ActiveStatus' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\IdleSeconds' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\LastInputTime' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\ActiveWindowTitle' OR path LIKE 'HKEY_USERS\\S-1-5-21-%\\Software\\Monetra\\Activity\\ActiveWindowUrl';",
          interval: activityInterval,
          snapshot: true,
          description: "High-frequency poll of user active/idle status and current window URL."
        }
      },
      // ATC (Auto Table Construction): Create virtual osquery tables backed by SQLite files.
      // This is the official osquery mechanism for querying external .db files.
      // osquery docs: https://osquery.readthedocs.io/en/stable/deployment/configuration/#automatic-table-construction
      auto_table_construction: {
        chrome_history_atc: {
          query: "SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 50",
          path: "C:\\ProgramData\\osquery\\chrome_history.db",
          columns: ["url", "title", "last_visit_time"]
        },
        edge_history_atc: {
          query: "SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 50",
          path: "C:\\ProgramData\\osquery\\edge_history.db",
          columns: ["url", "title", "last_visit_time"]
        }
      },
      packs: {}, // Extensible placeholder for custom query packs
      node_invalid: false
    };

    return NextResponse.json(configResponse);
  } catch (error) {
    console.error(`[API - Config] Internal error:`, error);
    return NextResponse.json(
      { error: "Internal Server Error", node_invalid: true },
      { status: 500 }
    );
  }
}
