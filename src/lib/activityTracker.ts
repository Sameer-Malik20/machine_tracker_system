/**
 * WFH Tracker System - Real-time Worker Activity & State Registry
 */

import connectDB from "./db";
import MachineLog from "./models/MachineLog";
import mongoose from "mongoose";

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

    // Asynchronously pre-populate the timeline statusHistory from DB in the background
    this.loadTodayHistoryFromDB(nodeKey).then(history => {
      const state = activityRegistry.get(nodeKey);
      if (state && history && history.length > 0) {
        state.statusHistory = history;
        // Set the active state to matches the latest DB entry state if available
        if (history[0] && history[0].status) {
          state.status = history[0].status;
        }
      }
    }).catch(err => {
      console.error(`[ActivityTracker] Background history pre-populate failed for node ${nodeKey}:`, err);
    });

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
      activityRegistry.set(nodeKey, state);

      // Asynchronously pre-populate the timeline statusHistory from DB in the background
      this.loadTodayHistoryFromDB(nodeKey).then(history => {
        const stateCurrent = activityRegistry.get(nodeKey);
        if (stateCurrent && history && history.length > 0) {
          stateCurrent.statusHistory = history;
          if (history[0] && history[0].status) {
            stateCurrent.status = history[0].status;
          }
        }
      }).catch(err => {
        console.error(`[ActivityTracker] Background history pre-populate failed for node ${nodeKey}:`, err);
      });
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

    // Try to extract real hostname and platform from the individual log items
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
        // Find maximum timestamp in this snapshot batch
        let maxTime = 0;
        for (const item of logItems) {
          const t = parseFloat(item.timestamp);
          if (t > maxTime) {
            maxTime = t;
          }
        }
        // Filter to keep only rows with maximum timestamp
        const latestItems = logItems.filter(item => parseFloat(item.timestamp) === maxTime);
        state.latestResults[queryName] = latestItems.map(item => item.columns);

        // Filter user_activity snapshot to keep only the active profile's rows
        if (queryName === "user_activity") {
          state.latestResults[queryName] = this.filterActiveProfileRows(state.latestResults[queryName]);
        } else if (queryName === "active_window") {
          const userActivity = state.latestResults["user_activity"] || [];
          const activePath = userActivity.find(r => r.name === "ActiveStatus")?.key || userActivity.find(r => r.name === "ActiveStatus")?.path || "";
          const match = activePath.match(/HKEY_USERS\\(S-1-5-21-[\d\-]+)/i);
          const activeSid = match ? match[1] : null;

          if (activeSid) {
            state.latestResults[queryName] = state.latestResults[queryName].filter(row => {
              const path = row.key || row.path || "";
              return path.includes(activeSid);
            });
          }
        }
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

    // Extract employee details from the active profile's user_activity
    const userActivity = state.latestResults?.["user_activity"];
    if (userActivity) {
      const empName = userActivity.find(r => r.name === "EmployeeName")?.data;
      const empId = userActivity.find(r => r.name === "EmployeeID")?.data;
      const email = userActivity.find(r => r.name === "EmployeeEmail")?.data;
      const dept = userActivity.find(r => r.name === "Department")?.data;

      if (empName) state.employeeName = empName;
      if (empId) state.employeeId = empId;
      if (email) state.email = email;
      if (dept) state.department = dept;
    }

    // Determine status from actual keyboard/mouse activity logs
    const idleSecondsStr = userActivity?.find(r => r.name === "IdleSeconds")?.data;
    const idleSeconds = idleSecondsStr ? parseInt(idleSecondsStr, 10) : 0;

    if (idleSeconds > logIntervalSecs) {
      this.updateStatus(state, "Idle");
    } else {
      this.updateStatus(state, "Active");
    }

    activityRegistry.set(nodeKey, state);
    return state;
  }

  /**
   * Filters registry query rows to only keep the rows belonging to the active user profile
   * (the profile with the minimum IdleSeconds).
   */
  static filterActiveProfileRows(rows: Record<string, string>[]): Record<string, string>[] {
    if (!rows || rows.length === 0) return [];

    // Group rows by user SID extracted from their key or path
    const profiles: Record<string, Record<string, string>[]> = {};
    for (const row of rows) {
      const path = row.key || row.path || "";
      const match = path.match(/HKEY_USERS\\(S-1-5-21-[\d\-]+)/i);
      const sid = match ? match[1] : "default";
      if (!profiles[sid]) {
        profiles[sid] = [];
      }
      profiles[sid].push(row);
    }

    // Find the profile with the minimum IdleSeconds
    let activeSid = "default";
    let minIdleSeconds = Infinity;

    for (const sid of Object.keys(profiles)) {
      const profileRows = profiles[sid];
      const idleSecsStr = profileRows.find(r => r.name === "IdleSeconds")?.data;
      const idleSecs = idleSecsStr ? parseInt(idleSecsStr, 10) : Infinity;
      if (idleSecs < minIdleSeconds) {
        minIdleSeconds = idleSecs;
        activeSid = sid;
      }
    }

    // Fallback to first profile if activeSid has no match or minIdleSeconds is Infinity
    if (minIdleSeconds === Infinity) {
      const keys = Object.keys(profiles);
      if (keys.length > 0) {
        activeSid = keys[0];
      }
    }

    return profiles[activeSid] || [];
  }

  /**
   * Fetches check-ins from the database user_activity logs dynamically using server logIntervalSecs.
   */
  static async getCheckinsFromDB(
    nodeKey: string,
    startTime: Date,
    endTime: Date,
    logIntervalSecs: number
  ): Promise<{ timestamp: Date; status: "Active" | "Idle" }[]> {
    const logs = await MachineLog.find({
      nodeKey,
      name: "user_activity",
      timestamp: { $gte: startTime, $lte: endTime }
    }).sort({ timestamp: 1 });

    if (logs.length === 0) return [];

    // Group logs by timestamp
    const logsByTimestamp: Record<string, any[]> = {};
    for (const log of logs) {
      const ts = log.timestamp.toISOString();
      if (!logsByTimestamp[ts]) {
        logsByTimestamp[ts] = [];
      }
      logsByTimestamp[ts].push(log);
    }

    const checkins: { timestamp: Date; status: "Active" | "Idle" }[] = [];

    // For each timestamp, find the active profile and check its IdleSeconds
    for (const ts of Object.keys(logsByTimestamp)) {
      const batch = logsByTimestamp[ts];
      const rows = batch.map(log => ({
        key: log.columns.key || "",
        path: log.columns.path || "",
        name: log.columns.name || "",
        data: log.columns.data || ""
      }));
      const activeRows = this.filterActiveProfileRows(rows);

      const idleSecondsStr = activeRows.find(r => r.name === "IdleSeconds")?.data;
      const idleSeconds = idleSecondsStr ? parseInt(idleSecondsStr, 10) : 0;

      const status = idleSeconds > logIntervalSecs ? ("Idle" as const) : ("Active" as const);
      checkins.push({
        timestamp: new Date(ts),
        status
      });
    }

    return checkins;
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
      const idleSecondsStr = userActivity?.find(r => r.name === "IdleSeconds")?.data;
      const idleSeconds = idleSecondsStr ? parseInt(idleSecondsStr, 10) : 0;

      if (secondsSinceLastHeartbeat > offlineThreshold) {
        this.updateStatus(node, "Offline");
      } else if (secondsSinceLastHeartbeat > maxExpectedInterval) {
        this.updateStatus(node, "Idle");
      } else if (idleSeconds > logIntervalSecs) {
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

    // If state matches and we already have some history
    if (state.status === newStatus && state.statusHistory.length > 0) {
      const latest = state.statusHistory[0];
      if (latest.endTime) {
        // If it was closed recently, reopen it (delete endTime and durationSeconds) so it continues in-memory
        const endTimeDate = typeof latest.endTime === "string" ? new Date(latest.endTime) : latest.endTime;
        const now = new Date();
        const gapSeconds = (now.getTime() - endTimeDate.getTime()) / 1000;
        if (gapSeconds < 300) { // reopen if closed within the last 5 minutes (e.g. server restart transition)
          delete latest.endTime;
          delete latest.durationSeconds;
        }
      }
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
    if (p.includes("darwin") || p.includes("mac") || p.includes("apple")) return "darwin";
    if (p.includes("win") || p.includes("microsoft")) return "windows";
    return "unknown";
  }

  static reconstructStatusHistory(
    checkins: { timestamp: Date; status: "Active" | "Idle" }[],
    startOfDay: Date,
    endOfDay: Date,
    intervalSecs: number,
    offlineThreshold: number
  ): StateTransition[] {
    const transitions: StateTransition[] = [];

    if (checkins.length === 0) {
      transitions.push({
        status: "Offline",
        startTime: startOfDay,
        endTime: endOfDay,
        durationSeconds: Math.floor((endOfDay.getTime() - startOfDay.getTime()) / 1000)
      });
      return transitions;
    }

    if (checkins[0].timestamp.getTime() > startOfDay.getTime()) {
      transitions.push({
        status: "Offline",
        startTime: startOfDay,
        endTime: checkins[0].timestamp,
        durationSeconds: Math.floor((checkins[0].timestamp.getTime() - startOfDay.getTime()) / 1000)
      });
    }

    for (let i = 0; i < checkins.length; i++) {
      const current = checkins[i];
      const next = checkins[i + 1];

      const startTime = current.timestamp;
      const status = current.status;

      if (next) {
        const gap = (next.timestamp.getTime() - current.timestamp.getTime()) / 1000;
        if (gap > offlineThreshold) {
          const offlineStart = new Date(current.timestamp.getTime() + intervalSecs * 1000);

          transitions.push({
            status,
            startTime,
            endTime: offlineStart,
            durationSeconds: Math.floor((offlineStart.getTime() - startTime.getTime()) / 1000)
          });

          transitions.push({
            status: "Offline",
            startTime: offlineStart,
            endTime: next.timestamp,
            durationSeconds: Math.floor((next.timestamp.getTime() - offlineStart.getTime()) / 1000)
          });
        } else {
          transitions.push({
            status,
            startTime,
            endTime: next.timestamp,
            durationSeconds: Math.floor((next.timestamp.getTime() - startTime.getTime()) / 1000)
          });
        }
      } else {
        const limitTime = endOfDay.getTime() < Date.now() ? endOfDay : new Date();
        const gap = (limitTime.getTime() - current.timestamp.getTime()) / 1000;
        if (gap > offlineThreshold) {
          const offlineStart = new Date(current.timestamp.getTime() + intervalSecs * 1000);
          transitions.push({
            status,
            startTime,
            endTime: offlineStart,
            durationSeconds: Math.floor((offlineStart.getTime() - startTime.getTime()) / 1000)
          });
          transitions.push({
            status: "Offline",
            startTime: offlineStart,
            endTime: limitTime,
            durationSeconds: Math.floor((limitTime.getTime() - offlineStart.getTime()) / 1000)
          });
        } else {
          transitions.push({
            status,
            startTime,
            endTime: limitTime,
            durationSeconds: Math.floor((limitTime.getTime() - startTime.getTime()) / 1000)
          });
        }
      }
    }

    const mergedTransitions: StateTransition[] = [];
    for (const trans of transitions) {
      if (mergedTransitions.length === 0) {
        mergedTransitions.push(trans);
      } else {
        const last = mergedTransitions[mergedTransitions.length - 1];
        if (last.status === trans.status) {
          last.endTime = trans.endTime;
          if (last.endTime) {
            last.durationSeconds = Math.floor((last.endTime.getTime() - last.startTime.getTime()) / 1000);
          } else {
            delete last.durationSeconds;
          }
        } else {
          mergedTransitions.push(trans);
        }
      }
    }

    return mergedTransitions.reverse();
  }

  private static async loadTodayHistoryFromDB(nodeKey: string): Promise<StateTransition[]> {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getTime() - 36 * 60 * 60 * 1000);

      const SettingsManager = require("./settings").SettingsManager;
      const settings = await SettingsManager.getSettings();
      const logIntervalSecs = (settings.logIntervalMinutes || 10) * 60;
      const offlineThreshold = logIntervalSecs * 2;

      const checkins = await this.getCheckinsFromDB(nodeKey, startOfDay, now, logIntervalSecs);
      return this.reconstructStatusHistory(checkins, startOfDay, now, logIntervalSecs, offlineThreshold);
    } catch (err) {
      console.error("[ActivityTracker] loadTodayHistoryFromDB error:", err);
      return [];
    }
  }
}
