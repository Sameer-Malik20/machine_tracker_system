import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { ActivityTracker, activityRegistry } from "@/lib/activityTracker";
import { SettingsManager } from "@/lib/settings";

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

    // Force re-enrollment if the node key is not recognized in memory (e.g. server restarted)
    if (!ActivityTracker.hasNode(nodeKey)) {
      console.warn(`[API - Config] Unrecognized node key: ${nodeKey}. Triggering re-enrollment.`);
      return NextResponse.json({ node_invalid: true }, { status: 200 });
    }

    // Retrieve host from registry to check platform
    const host = ActivityTracker.hasNode(nodeKey) ? activityRegistry.get(nodeKey) : null;
    const platform = host ? host.platform : "windows";

    // Update check-in heartbeat for this node key
    ActivityTracker.registerNode(nodeKey, host?.hostname || `host_${nodeKey.substring(14, 20)}`, platform);

    console.log(`[API - Config] Config request received from node key: ${nodeKey} (Platform: ${platform})`);

    // Fetch dynamic admin-configured intervals
    const intervals = SettingsManager.getIntervalsForPlatform(platform);

    // Return the scheduled queries configuration (Osquery packs structure)
    const configResponse = {
      schedule: {
        running_processes: {
          query: "SELECT name, pid, path, resident_size FROM processes;",
          interval: intervals.processInterval,
          description: "Tracks active applications and background processes currently running on the endpoint."
        },
        system_performance: {
          query: "SELECT hostname, cpu_brand, physical_memory, (SELECT name FROM os_version) as os_name, (SELECT platform FROM os_version) as os_platform FROM system_info;",
          interval: intervals.performanceInterval,
          snapshot: true,
          description: "Collects host hardware architecture and system specifications every 120 seconds."
        },
        active_network_sockets: {
          query: "SELECT pid, local_address, local_port, remote_address, remote_port, state FROM process_open_sockets;",
          interval: intervals.networkInterval,
          snapshot: true,
          description: "Collects active network sockets (established and listening ports) on the system."
        },
        user_activity: {
          query: "SELECT name, data FROM registry WHERE path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\ActiveStatus' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\IdleSeconds' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\LastInputTime' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\EmployeeName' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\EmployeeID' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\EmployeeEmail' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\Department' FROM users WHERE uuid LIKE 'S-1-5-21-%');",
          interval: intervals.activityInterval,
          snapshot: true,
          description: "Tracks active user keyboard and mouse interaction telemetry from the Windows Registry."
        },
        chrome_history: {
          // Uses the ATC virtual table 'chrome_history_atc' defined below
          query: "SELECT url, title, last_visit_time FROM chrome_history_atc ORDER BY last_visit_time DESC LIMIT 20;",
          interval: 10,
          snapshot: true,
          description: "Retrieves Chrome browser history from the copied SQLite database via ATC."
        },
        edge_history: {
          // Uses the ATC virtual table 'edge_history_atc' defined below
          query: "SELECT url, title, last_visit_time FROM edge_history_atc ORDER BY last_visit_time DESC LIMIT 20;",
          interval: 10,
          snapshot: true,
          description: "Retrieves Edge browser history from the copied SQLite database via ATC."
        },
        window_history: {
          // activity_monitor.ps1 writes to HKCU\Software\Monetra\Activity\WindowHistory
          // HKCU maps to HKEY_USERS\<SID> - query both paths for maximum compatibility
          query: "SELECT name as timestamp, data as details FROM registry WHERE key IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\WindowHistory' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR key = 'HKEY_CURRENT_USER\\\\Software\\\\Monetra\\\\Activity\\\\WindowHistory';",
          interval: 10,
          snapshot: true,
          description: "Tracks active window foreground changes over time."
        },
        active_window: {
          // Reads the current foreground window and employee activity from HKCU directly
          query: "SELECT name, data FROM registry WHERE path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\ActiveStatus' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\IdleSeconds' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\LastInputTime' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\ActiveWindowTitle' FROM users WHERE uuid LIKE 'S-1-5-21-%') OR path IN (SELECT 'HKEY_USERS\\\\' || uuid || '\\\\Software\\\\Monetra\\\\Activity\\\\ActiveWindowUrl' FROM users WHERE uuid LIKE 'S-1-5-21-%');",
          interval: 10,
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
