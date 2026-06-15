/**
 * WFH Tracker System - Real-time Worker Activity & State Registry
 */

export interface StateTransition {
  status: "Active" | "Idle" | "Offline";
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
}

export interface HostActivityState {
  nodeKey: string;
  hostname: string;
  employeeName?: string; // mapped from registry/employee.json
  employeeId?: string;   // e.g. EMP-1042
  email?: string;        // e.g. sameer.malik@monetra.com
  department?: string;   // e.g. Engineering
  platform: "windows" | "darwin" | "unknown";
  lastHeartbeat: Date;
  lastLogIntervalDeltaSeconds: number;
  status: "Active" | "Idle" | "Offline";
  recentQueries: {
    queryName: string;
    timestamp: Date;
    rowCount: number;
  }[];
  latestResults?: Record<string, Record<string, string>[]>; // maps queryName to array of result rows
  statusHistory?: StateTransition[];
  lastLogSaveTime?: Date;
  lastQuerySaveTimes?: Record<string, Date>;
  latestCheckinDebug?: {
    selectedFrequencyMinutes: number;
    selectedFrequencySeconds: number;
    timeSinceLastCheckinSeconds: number | string;
    timeSinceLastSaveSeconds: number | string;
    receivedQueriesBreakdown: Record<string, number>;
    missingQueries: string[];
    completeness: string;
    rateLimitedDroppedCount: number;
    timestamp: Date;
  };
}

// Global caching pattern for Next.js hot-reloading
const globalForActivity = globalThis as unknown as {
  activityRegistry: Map<string, HostActivityState>;
};

if (!globalForActivity.activityRegistry) {
  // Seeding removed - starts completely clean for 100% real data
  globalForActivity.activityRegistry = new Map<string, HostActivityState>();
}

export const activityRegistry = globalForActivity.activityRegistry;

export class ActivityTracker {
  // Configurable thresholds for state transitions (in seconds)
  private static readonly MAX_EXPECTED_LOG_INTERVAL = 180; // 3 minutes (2x system info, 3x process logs)
  private static readonly OFFLINE_THRESHOLD = 600;         // 10 minutes (no logs at all)

  /**
   * Check if a node is already enrolled in the memory registry.
   */
  static hasNode(nodeKey: string): boolean {
    return activityRegistry.has(nodeKey);
  }

  /**
   * Registers or updates a client node when they check in (e.g., config fetch)
   */
  static registerNode(nodeKey: string, hostname: string, platform: string): HostActivityState {
    const existing = activityRegistry.get(nodeKey);
    const now = new Date();

    if (existing) {
      // Avoid overwriting a real hostname/platform with placeholders during config checks
      if (hostname !== "unknown_host" && !hostname.startsWith("host_") && hostname !== "") {
        existing.hostname = hostname;
      }
      if (platform !== "unknown") {
        existing.platform = this.parsePlatform(platform);
      }
      existing.lastHeartbeat = now;
      activityRegistry.set(nodeKey, existing);
      return existing;
    }

    // Clean up any duplicate/stale keys for the same hostname to prevent duplicates on UI
    if (hostname && hostname !== "unknown_host" && !hostname.startsWith("host_") && hostname !== "") {
      for (const [key, val] of activityRegistry.entries()) {
        if (val.hostname && val.hostname.toLowerCase() === hostname.toLowerCase() && key !== nodeKey) {
          console.log(`[ActivityTracker] Removing duplicate/stale registry entry for ${hostname} (old key: ${key})`);
          activityRegistry.delete(key);
        }
      }
    }

    const newState: HostActivityState = {
      nodeKey,
      hostname,
      platform: this.parsePlatform(platform),
      lastHeartbeat: now,
      lastLogIntervalDeltaSeconds: 0,
      status: "Active",
      recentQueries: [],
      latestResults: {},
      statusHistory: []
    };
    this.updateStatus(newState, "Active");

    activityRegistry.set(nodeKey, newState);
    return newState;
  }

  /**
   * Processes log heartbeats with complete column records
   */
  static processLogCheckinWithLogs(
    nodeKey: string,
    logs: { name: string; action: string; columns: Record<string, string>; timestamp: string }[],
    hostIdentifier?: string | null,
    logIntervalSecs: number = 600
  ): HostActivityState {
    const now = new Date();
    let state = activityRegistry.get(nodeKey);

    if (!state) {
      // Lazy creation if node checked in without config cycle first
      state = {
        nodeKey,
        hostname: hostIdentifier && hostIdentifier !== "unknown_host" && !hostIdentifier.startsWith("host_")
          ? hostIdentifier
          : `host_${nodeKey.substring(14, 20)}`,
        platform: "unknown",
        lastHeartbeat: now,
        lastLogIntervalDeltaSeconds: 0,
        status: "Active",
        recentQueries: [],
        latestResults: {},
        statusHistory: []
      };
      this.updateStatus(state, "Active");
    } else {
      // If we already have a state but its hostname is generic and we received a real one, update it
      if (hostIdentifier && hostIdentifier !== "unknown_host" && !hostIdentifier.startsWith("host_")) {
        state.hostname = hostIdentifier;
      }
    }

    // Clean up any duplicate/stale keys for the same hostname to prevent duplicates on UI
    if (state.hostname && state.hostname !== "unknown_host" && !state.hostname.startsWith("host_") && state.hostname !== "") {
      for (const [key, val] of activityRegistry.entries()) {
        if (val.hostname && val.hostname.toLowerCase() === state.hostname.toLowerCase() && key !== nodeKey) {
          console.log(`[ActivityTracker] Removing duplicate/stale registry entry for ${state.hostname} (old key: ${key}) during log check-in`);
          activityRegistry.delete(key);
        }
      }
    }

    if (!state.latestResults) {
      state.latestResults = {};
    }

    // Try to extract real hostname, employeeName, and platform from the individual log items
    for (const log of logs) {
      if (log && log.columns) {
        const hostnameCol = log.columns.hostname;
        if (hostnameCol && hostnameCol !== "unknown_host" && !hostnameCol.startsWith("host_") && hostnameCol !== "") {
          state.hostname = hostnameCol;
        }

        const platformCol = log.columns.os_platform || log.columns.platform;
        if (platformCol && platformCol !== "unknown" && platformCol !== "") {
          state.platform = this.parsePlatform(platformCol);
        }

        // Extract employee alias/name if sent via Windows registry log
        if (log.name === "user_activity" && log.columns.name === "EmployeeName" && log.columns.data) {
          state.employeeName = log.columns.data;
        }
        if (log.name === "user_activity" && log.columns.name === "EmployeeID" && log.columns.data) {
          state.employeeId = log.columns.data;
        }
        if (log.name === "user_activity" && log.columns.name === "EmployeeEmail" && log.columns.data) {
          state.email = log.columns.data;
        }
        if (log.name === "user_activity" && log.columns.name === "Department" && log.columns.data) {
          state.department = log.columns.data;
        }
      }
    }

    // Calculate time delta since last heartbeat
    const deltaSeconds = Math.floor((now.getTime() - state.lastHeartbeat.getTime()) / 1000);
    state.lastLogIntervalDeltaSeconds = deltaSeconds;
    state.lastHeartbeat = now;

    // Group logs by query name
    const groupedLogs: Record<string, typeof logs> = {};
    for (const log of logs) {
      if (!log || !log.name) continue;
      if (!groupedLogs[log.name]) {
        groupedLogs[log.name] = [];
      }
      groupedLogs[log.name].push(log);
    }

    // Update query metrics cache and store/merge latest results columns
    for (const [queryName, logItems] of Object.entries(groupedLogs)) {
      if (!state.latestResults[queryName]) {
        state.latestResults[queryName] = [];
      }

      const isSnapshot = logItems.some(item => item.action === "snapshot");

      if (isSnapshot) {
        // Clear and replace entirely for snapshot queries
        state.latestResults[queryName] = logItems.map(item => item.columns);
      } else {
        // Merge diff updates (respecting 'added' and 'removed')
        const list = state.latestResults[queryName];

        for (const item of logItems) {
          const cols = item.columns;
          const action = item.action;

          let index = -1;
          if (queryName === "running_processes") {
            index = list.findIndex(r => r.pid === cols.pid);
          } else if (queryName === "user_activity") {
            index = list.findIndex(r => r.name === cols.name);
          } else if (queryName === "active_network_sockets") {
            index = list.findIndex(r =>
              r.pid === cols.pid &&
              r.local_port === cols.local_port &&
              r.remote_port === cols.remote_port
            );
          } else {
            index = list.findIndex(r => JSON.stringify(r) === JSON.stringify(cols));
          }

          if (action === "added") {
            if (index > -1) {
              list[index] = cols; // Update existing
            } else {
              list.push(cols); // Add new
            }
          } else if (action === "removed") {
            if (index > -1) {
              list.splice(index, 1); // Remove
            }
          }
        }
      }

      state.recentQueries.unshift({
        queryName,
        timestamp: now,
        rowCount: logItems.length
      });
    }

    // Cap query deliveries cache at 10 items
    if (state.recentQueries.length > 10) {
      state.recentQueries = state.recentQueries.slice(0, 10);
    }

    // Determine status from actual keyboard/mouse activity logs
    const userActivity = state.latestResults?.["user_activity"];
    const activeStatus = userActivity?.find(r => r.name === "ActiveStatus")?.data;

    if (activeStatus === "Idle") {
      this.updateStatus(state, "Idle");
    } else {
      this.updateStatus(state, "Active");
    }

    activityRegistry.set(nodeKey, state);
    return state;
  }

  /**
   * Processes an incoming log payload to calculate the active/idle status (legacy backward compatibility)
   */
  static processLogCheckin(nodeKey: string, queryName: string, rowCount: number, logIntervalSecs: number = 600): HostActivityState {
    const now = new Date();
    let state = activityRegistry.get(nodeKey);

    if (!state) {
      state = {
        nodeKey,
        hostname: `host_${nodeKey.substring(14, 20)}`,
        platform: "unknown",
        lastHeartbeat: now,
        lastLogIntervalDeltaSeconds: 0,
        status: "Active",
        recentQueries: [],
        statusHistory: []
      };
      this.updateStatus(state, "Active");
    }

    const deltaSeconds = Math.floor((now.getTime() - state.lastHeartbeat.getTime()) / 1000);
    state.lastLogIntervalDeltaSeconds = deltaSeconds;
    state.lastHeartbeat = now;

    this.updateStatus(state, "Active");

    state.recentQueries.unshift({
      queryName,
      timestamp: now,
      rowCount
    });
    if (state.recentQueries.length > 5) {
      state.recentQueries.pop();
    }

    activityRegistry.set(nodeKey, state);
    return state;
  }

  /**
   * Evaluates all nodes and applies offline rules for nodes that haven't sent heartbeats.
   */
  static getActiveRegistry(logIntervalSecs: number = 600): HostActivityState[] {
    const now = new Date();
    const list = Array.from(activityRegistry.values());

    const maxExpectedInterval = Math.max(180, logIntervalSecs * 1.0);
    const offlineThreshold = Math.max(600, logIntervalSecs * 2.0);

    for (const node of list) {
      const secondsSinceLastHeartbeat = Math.floor((now.getTime() - node.lastHeartbeat.getTime()) / 1000);
      const userActivity = node.latestResults?.["user_activity"];
      const activeStatus = userActivity?.find(r => r.name === "ActiveStatus")?.data;

      if (secondsSinceLastHeartbeat > offlineThreshold) {
        this.updateStatus(node, "Offline");
      } else if (secondsSinceLastHeartbeat > maxExpectedInterval) {
        this.updateStatus(node, "Idle");
      } else if (activeStatus === "Idle") {
        this.updateStatus(node, "Idle");
      } else {
        this.updateStatus(node, "Active");
      }
    }

    return list;
  }

  /**
   * Updates state transition history safely
   */
  private static updateStatus(state: HostActivityState, newStatus: "Active" | "Idle" | "Offline") {
    if (!state.statusHistory) {
      state.statusHistory = [];
    }

    // Do nothing if state matches and we already have some history
    if (state.status === newStatus && state.statusHistory.length > 0) {
      return;
    }

    const now = new Date();

    // Close the previous transition
    if (state.statusHistory.length > 0) {
      const prev = state.statusHistory[0];
      if (!prev.endTime) {
        prev.endTime = now;
        prev.durationSeconds = Math.floor((now.getTime() - prev.startTime.getTime()) / 1000);
      }
    }

    state.status = newStatus;
    state.statusHistory.unshift({
      status: newStatus,
      startTime: now
    });

    if (state.statusHistory.length > 100) {
      state.statusHistory = state.statusHistory.slice(0, 100);
    }
  }

  /**
   * Generates realistic seeded data for a beautiful employee work schedule (9:00 AM - 6:00 PM)
   */
  private static generateSeededHistory(): StateTransition[] {
    const history: StateTransition[] = [];
    const today = new Date();

    const getDateAt = (hours: number, minutes: number) => {
      const d = new Date(today);
      d.setHours(hours, minutes, 0, 0);
      return d;
    };

    // Active: 09:00 - 10:15
    history.push({
      status: "Active",
      startTime: getDateAt(9, 0),
      endTime: getDateAt(10, 15),
      durationSeconds: 75 * 60
    });

    // Idle: 10:15 - 10:35
    history.push({
      status: "Idle",
      startTime: getDateAt(10, 15),
      endTime: getDateAt(10, 35),
      durationSeconds: 20 * 60
    });

    // Active: 10:35 - 12:30
    history.push({
      status: "Active",
      startTime: getDateAt(10, 35),
      endTime: getDateAt(12, 30),
      durationSeconds: 115 * 60
    });

    // Offline: 12:30 - 13:00
    history.push({
      status: "Offline",
      startTime: getDateAt(12, 30),
      endTime: getDateAt(13, 0),
      durationSeconds: 30 * 60
    });

    // Idle (Lunch): 13:00 - 14:00
    history.push({
      status: "Idle",
      startTime: getDateAt(13, 0),
      endTime: getDateAt(14, 0),
      durationSeconds: 60 * 60
    });

    // Active: 14:00 - 15:45
    history.push({
      status: "Active",
      startTime: getDateAt(14, 0),
      endTime: getDateAt(15, 45),
      durationSeconds: 105 * 60
    });

    // Idle: 15:45 - 16:05
    history.push({
      status: "Idle",
      startTime: getDateAt(15, 45),
      endTime: getDateAt(16, 5),
      durationSeconds: 20 * 60
    });

    // Active: 16:05 - end of workday / now
    const activeStart = getDateAt(16, 5);
    const activeEnd = new Date();
    history.push({
      status: "Active",
      startTime: activeStart,
      endTime: activeEnd,
      durationSeconds: Math.floor((activeEnd.getTime() - activeStart.getTime()) / 1000)
    });

    return history.reverse();
  }

  private static parsePlatform(platform: string): "windows" | "darwin" | "unknown" {
    const p = platform.toLowerCase();
    if (p.includes("win") || p.includes("microsoft")) return "windows";
    if (p.includes("darwin") || p.includes("mac") || p.includes("apple")) return "darwin";
    return "unknown";
  }
}
