"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface QueryLog {
  queryName: string;
  timestamp: string;
  rowCount: number;
}

interface StateTransition {
  status: "Active" | "Idle" | "Offline";
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
}

interface Host {
  nodeKey: string;
  hostname: string;
  employeeName?: string;
  employeeId?: string;
  email?: string;
  department?: string;
  platform: "windows" | "darwin" | "unknown";
  lastHeartbeat: string;
  lastLogIntervalDeltaSeconds: number;
  status: "Active" | "Idle" | "Offline";
  recentQueries: QueryLog[];
  latestResults?: Record<string, Record<string, string>[]>;
  statusHistory?: StateTransition[];
  latestCheckinDebug?: {
    selectedFrequencyMinutes: number;
    selectedFrequencySeconds: number;
    timeSinceLastCheckinSeconds: number | string;
    timeSinceLastSaveSeconds: number | string;
    receivedQueriesBreakdown: Record<string, number>;
    missingQueries: string[];
    completeness: string;
    rateLimitedDroppedCount: number;
    timestamp: string;
  };
}

interface NotificationItem {
  id: string;
  nodeKey: string;
  employeeName?: string;
  hostname: string;
  type: "active" | "idle" | "offline";
  message: string;
  timestamp: string; // ISO string
  read: boolean;
}

export default function DashboardPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("wfh-notifications");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse notifications", e);
        }
      }
    }
    return [];
  });
  const prevStatusesRef = useRef<Record<string, "Active" | "Idle" | "Offline">>({});
  const [inspectingNodeKey, setInspectingNodeKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"logs" | "processes" | "network" | "activity" | "timeline" | "history">("processes");
  const [subTab, setSubTab] = useState<"windows" | "browser">("windows");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("wfh-theme") as "dark" | "light" | null;
      return savedTheme || "dark";
    }
    return "dark";
  });

  // View states: 'dashboard' | 'endpoints' | 'osquery' | 'charts' | 'settings'
  const [currentView, setCurrentView] = useState<"dashboard" | "endpoints" | "osquery" | "charts" | "settings">("dashboard");
  const [topNavFilter, setTopNavFilter] = useState<"all" | "Active" | "Idle" | "Offline">("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  // SQL Console states
  const [consoleQuery, setConsoleQuery] = useState("SELECT name, pid, path, resident_size FROM processes;");
  const [consoleTargetHost, setConsoleTargetHost] = useState("");
  const [consoleResult, setConsoleResult] = useState<Record<string, string>[] | null>(null);
  const [consoleError, setConsoleError] = useState("");
  const [consoleLoading, setConsoleLoading] = useState(false);

  // Analytics Chart Range state
  const [chartRange, setChartRange] = useState<"today" | "7d" | "30d">("today");

  // User Auth States
  const [currentUser, setCurrentUser] = useState<{ email: string; role: "super_admin" | "admin" } | null>(null);
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newAdminAssigned, setNewAdminAssigned] = useState<string[]>([]);
  const [showCreateAdminModal, setShowCreateAdminModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Admin settings states
  const [settings, setSettings] = useState<{
    logIntervalMinutes: number;
    dataRetentionDays: number;
    retentionAction: "delete" | "archive";
    windows: { processInterval: number; performanceInterval: number; networkInterval: number; activityInterval: number };
    mac: { processInterval: number; performanceInterval: number; networkInterval: number; activityInterval: number };
  }>({
    logIntervalMinutes: 10,
    dataRetentionDays: 30,
    retentionAction: "archive",
    windows: { processInterval: 60, performanceInterval: 120, networkInterval: 60, activityInterval: 60 },
    mac: { processInterval: 60, performanceInterval: 120, networkInterval: 60, activityInterval: 60 }
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  // Notification panel state
  const [notifOpen, setNotifOpen] = useState(false);

  const todayStr = (() => {
    if (typeof window === "undefined") return "";
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localNow = new Date(now.getTime() - offset * 60 * 1000);
    return localNow.toISOString().split("T")[0];
  })();

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [historyData, setHistoryData] = useState<any | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Initialize selectedDate when component mounts or a host is inspected
  useEffect(() => {
    if (inspectingNodeKey) {
      const now = new Date();
      const offset = now.getTimezoneOffset();
      const localNow = new Date(now.getTime() - offset * 60 * 1000);
      setSelectedDate(localNow.toISOString().split("T")[0]);
      setHistoryData(null);
      setHistoryError(null);
    }
  }, [inspectingNodeKey]);

  // Fetch history when selectedDate or inspectingNodeKey changes
  useEffect(() => {
    if (!inspectingNodeKey) {
      setHistoryData(null);
      return;
    }

    const currentTodayStr = (() => {
      const now = new Date();
      const offset = now.getTimezoneOffset();
      const localNow = new Date(now.getTime() - offset * 60 * 1000);
      return localNow.toISOString().split("T")[0];
    })();

    if (selectedDate === currentTodayStr) {
      setHistoryData(null);
      setHistoryError(null);
      return;
    }

    if (!selectedDate) return;

    let isCurrent = true;
    const fetchHistory = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const res = await fetch(`/api/osquery/history?nodeKey=${inspectingNodeKey}&date=${selectedDate}&tzOffset=${tzOffset}`);
        if (!res.ok) {
          throw new Error("Failed to fetch historical telemetry.");
        }
        const data = await res.json();
        if (isCurrent) {
          setHistoryData(data);
        }
      } catch (err: any) {
        if (isCurrent) {
          setHistoryError(err.message || "An error occurred fetching history.");
        }
      } finally {
        if (isCurrent) {
          setHistoryLoading(false);
        }
      }
    };

    fetchHistory();

    return () => {
      isCurrent = false;
    };
  }, [selectedDate, inspectingNodeKey]);

  const inspectingHost = inspectingNodeKey
    ? hosts.find((h) => h.nodeKey === inspectingNodeKey) || null
    : null;

  const displayHost: Host | null = historyData
    ? {
      nodeKey: historyData.nodeKey,
      hostname: historyData.hostname,
      platform: historyData.platform as "windows" | "darwin" | "unknown",
      lastHeartbeat: historyData.lastHeartbeat,
      lastLogIntervalDeltaSeconds: 0,
      status: (historyData.statusHistory?.[0]?.status || "Offline") as "Active" | "Idle" | "Offline",
      recentQueries: (historyData.recentQueries || []).map((q: any) => ({
        queryName: q.queryName,
        timestamp: q.timestamp,
        rowCount: q.rowCount
      })),
      latestResults: historyData.latestResults || {},
      statusHistory: (historyData.statusHistory || []).map((s: any) => ({
        status: s.status as "Active" | "Idle" | "Offline",
        startTime: s.startTime,
        endTime: s.endTime,
        durationSeconds: s.durationSeconds
      })),
      employeeName: inspectingHost?.employeeName,
      employeeId: inspectingHost?.employeeId,
      email: inspectingHost?.email,
      department: inspectingHost?.department,
      latestCheckinDebug: historyData.latestCheckinDebug
    }
    : inspectingHost;

  // Sync theme with document element attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Close notification panel on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      const btn = document.getElementById("notif-bell-btn");
      const dropdown = document.querySelector(".notif-dropdown");
      if (
        (btn && btn.contains(e.target as Node)) ||
        (dropdown && dropdown.contains(e.target as Node))
      ) {
        return;
      }
      setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen]);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const avatar = document.querySelector(".topnav-avatar");
      const menu = document.querySelector(".profile-menu-dropdown");
      if (
        (avatar && avatar.contains(e.target as Node)) ||
        (menu && menu.contains(e.target as Node))
      ) {
        return;
      }
      setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("wfh-theme", nextTheme);
  };

  // Fetch host states
  useEffect(() => {
    let isMounted = true;

    const fetchHosts = async () => {
      try {
        const res = await fetch("/api/osquery/hosts");
        if (res.ok && isMounted) {
          const data: Host[] = await res.json();
          setHosts(data);

          if (data.length > 0) {
            setConsoleTargetHost(prev => {
              const exists = data.some(h => h.nodeKey === prev);
              return exists ? prev : data[0].nodeKey;
            });
          } else {
            setConsoleTargetHost("");
          }
        }
      } catch (error) {
        console.error("Error polling hosts:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchHosts();
    const interval = setInterval(fetchHosts, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Load session information and redirect if unauthorized
  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
        } else {
          window.location.href = "/login";
        }
      } catch (err) {
        console.error("Failed to load user info:", err);
      }
    };
    fetchMe();
  }, []);

  // Fetch administrator users list (super_admin only)
  const fetchAdmins = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setAdminsList(data);
      }
    } catch (err) {
      console.error("Failed to fetch admin users:", err);
    }
  };

  useEffect(() => {
    if (currentUser?.role === "super_admin" && currentView === "settings") {
      fetchAdmins();
    }
  }, [currentUser, currentView]);

  // Fetch settings on load
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    fetchSettings();
  }, []);



  // Save notifications to local storage on change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wfh-notifications", JSON.stringify(notifications));
    }
  }, [notifications]);

  // Transition detection effect
  useEffect(() => {
    if (hosts.length === 0) return;

    const newNotifications: NotificationItem[] = [];
    const prevStatuses = prevStatusesRef.current;
    const hasPrevious = Object.keys(prevStatuses).length > 0;

    hosts.forEach((host) => {
      const prevStatus = prevStatuses[host.nodeKey];
      if (prevStatus && prevStatus !== host.status) {
        let msg = "";
        if (host.status === "Offline") {
          msg = `${host.employeeName || host.hostname} went Offline.`;
        } else if (host.status === "Idle") {
          msg = `${host.employeeName || host.hostname} is Idle (inactive).`;
        } else if (host.status === "Active") {
          msg = `${host.employeeName || host.hostname} is back online.`;
        }

        newNotifications.push({
          id: `${host.nodeKey}-${Date.now()}-${Math.random()}`,
          nodeKey: host.nodeKey,
          employeeName: host.employeeName,
          hostname: host.hostname,
          type: host.status.toLowerCase() as "active" | "idle" | "offline",
          message: msg,
          timestamp: new Date().toISOString(),
          read: false
        });
      }
      prevStatuses[host.nodeKey] = host.status;
    });

    if (newNotifications.length > 0) {
      setNotifications(prev => [...newNotifications, ...prev].slice(0, 50));

      try {
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.08, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + duration);
        };
        const now = audioCtx.currentTime;
        playTone(587.33, now, 0.12);
        playTone(880.00, now + 0.1, 0.25);
      } catch {
        // ignore
      }
    }

    if (!hasPrevious) {
      hosts.forEach((host) => {
        prevStatuses[host.nodeKey] = host.status;
      });
    }
  }, [hosts]);

  const handleSaveSettings = async (newSettings: typeof settings) => {
    setSettingsSaving(true);
    setSettingsStatus(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (res.ok) {
        setSettingsStatus("success: Settings saved successfully!");
        setTimeout(() => setSettingsStatus(null), 3000);

        // Force an immediate fetch of hosts so the UI receives the updated settings frequency instantly
        try {
          const hostsRes = await fetch("/api/osquery/hosts");
          if (hostsRes.ok) {
            const data = await hostsRes.json();
            setHosts(data);
          }
        } catch (hostsErr) {
          console.error("Failed to instantly refetch hosts:", hostsErr);
        }
      } else {
        setSettingsStatus("error: Failed to save settings.");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSettingsStatus("error: Failed to save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  // Aggregate metrics
  const totalCount = hosts.length;
  const activeCount = hosts.filter((h) => h.status === "Active").length;
  const idleCount = hosts.filter((h) => h.status === "Idle").length;
  const offlineCount = hosts.filter((h) => h.status === "Offline").length;
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Extract unique departments dynamically from hosts
  const uniqueDepts = Array.from(new Set(hosts.map((h) => h.department).filter(Boolean))) as string[];

  // Filter hosts by search, topnav status pills, platform, and department
  const filteredHosts = hosts.filter((h) => {
    const matchesSearch =
      h.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.employeeName && h.employeeName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      h.platform.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      topNavFilter === "all" || h.status === topNavFilter;

    const matchesPlatform =
      platformFilter === "all" || h.platform === platformFilter;

    const matchesDept =
      deptFilter === "all" || h.department === deptFilter;

    return matchesSearch && matchesFilter && matchesPlatform && matchesDept;
  });

  // Utilities
  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "N/A";
    }
  };

  const getPlatformIcon = (platform: Host["platform"]) => {
    switch (platform) {
      case "windows":
        return "⊞";
      case "darwin":
        return "⌘";
      default:
        return "⚙";
    }
  };

  const formatBytesToMB = (bytesStr: string | number) => {
    const bytes = typeof bytesStr === "string" ? parseInt(bytesStr, 10) : bytesStr;
    if (isNaN(bytes)) return "N/A";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Helper to format query result rows as an ASCII table
  const formatAsAsciiTable = (data: Record<string, string>[] | null): string => {
    if (!data || data.length === 0) return "No rows returned.";

    // Get all unique keys
    const keys = Array.from(new Set(data.flatMap(row => Object.keys(row))));
    if (keys.length === 0) return "Empty result set.";

    // Calculate max width for each column
    const colWidths: Record<string, number> = {};
    keys.forEach(key => {
      colWidths[key] = key.length;
    });

    data.forEach(row => {
      keys.forEach(key => {
        const val = String(row[key] ?? "");
        if (val.length > colWidths[key]) {
          colWidths[key] = val.length;
        }
      });
    });

    // Build top/bottom border
    let border = "+";
    keys.forEach(key => {
      border += "-".repeat(colWidths[key] + 2) + "+";
    });

    // Build header row
    let header = "|";
    keys.forEach(key => {
      header += " " + key.padEnd(colWidths[key]) + " |";
    });

    // Build data rows
    const rows: string[] = [];
    data.forEach(row => {
      let r = "|";
      keys.forEach(key => {
        const val = String(row[key] ?? "");
        r += " " + val.padEnd(colWidths[key]) + " |";
      });
      rows.push(r);
    });

    return [border, header, border, ...rows, border].join("\n");
  };

  // Run mock/interactive SQL query based on real agent log structures
  const runConsoleQuery = () => {
    if (!consoleTargetHost) {
      setConsoleError("Error: No active target worker selected.");
      return;
    }

    setConsoleLoading(true);
    setConsoleError("");
    setConsoleResult(null);

    const target = hosts.find(h => h.nodeKey === consoleTargetHost);

    setTimeout(() => {
      if (!target) {
        setConsoleError("Error: Targeted host is disconnected or unavailable.");
        setConsoleLoading(false);
        return;
      }

      const queryLower = consoleQuery.toLowerCase();
      const queryName = queryLower.includes("registry") || queryLower.includes("activity")
        ? "user_activity"
        : queryLower.includes("system_info") || queryLower.includes("hardware") || queryLower.includes("system")
          ? "system_performance"
          : queryLower.includes("listening_ports") || queryLower.includes("ports") || queryLower.includes("socket") || queryLower.includes("network")
            ? "active_network_sockets"
            : "running_processes";

      const results = target.latestResults?.[queryName];

      if (results && results.length > 0) {
        setConsoleResult(results);
      } else {
        setConsoleResult([]);
        setConsoleError(`Query ran successfully but returned 0 rows. (Awaiting telemetry data for '${queryName}')`);
      }
    }, 800);
  };

  // Export all machines data to CSV (opens natively in Excel)
  const exportToExcel = () => {
    const escapeCSV = (val: string | number | undefined | null) => {
      if (val === undefined || val === null) return '""';
      const str = String(val);
      if (str.includes(",") || str.includes("\"") || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const headers = [
      "Employee Name",
      "Employee ID",
      "Email Address",
      "Department",
      "Hostname",
      "Node Key",
      "Platform",
      "Current Status",
      "Last Heartbeat",
      "Inactivity Delta (Secs)",
      "Inactivity Idle (Secs)",
      "Active Duration Today (mins)",
      "Idle Duration Today (mins)",
      "Offline Duration Today (mins)",
      "Idle Events Count Today",
      "Offline Events Count Today"
    ];

    const rows = hosts.map(h => {
      const todayStr = new Date().toDateString();
      const historyToday = (h.statusHistory || []).filter(t => {
        try { return new Date(t.startTime).toDateString() === todayStr; } catch { return false; }
      });

      const totalActiveSecs = historyToday
        .filter(t => t.status === "Active")
        .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
      const totalIdleSecs = historyToday
        .filter(t => t.status === "Idle")
        .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
      const totalOfflineSecs = historyToday
        .filter(t => t.status === "Offline")
        .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);

      const idleCountToday = historyToday.filter(t => t.status === "Idle").length;
      const offlineCountToday = historyToday.filter(t => t.status === "Offline").length;

      const userActivityResults = h.latestResults?.["user_activity"];
      const currentIdleSecs = userActivityResults?.find(r => r.name === "IdleSeconds")?.data || "0";

      return [
        escapeCSV(h.employeeName || "Unknown"),
        escapeCSV(h.employeeId || "—"),
        escapeCSV(h.email || "—"),
        escapeCSV(h.department || "—"),
        escapeCSV(h.hostname),
        escapeCSV(h.nodeKey),
        escapeCSV(h.platform),
        escapeCSV(h.status),
        escapeCSV(new Date(h.lastHeartbeat).toLocaleString()),
        escapeCSV(h.lastLogIntervalDeltaSeconds),
        escapeCSV(currentIdleSecs),
        escapeCSV(Math.round(totalActiveSecs / 60)),
        escapeCSV(Math.round(totalIdleSecs / 60)),
        escapeCSV(Math.round(totalOfflineSecs / 60)),
        escapeCSV(idleCountToday),
        escapeCSV(offlineCountToday)
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(r => r.join(","))
    ].join("\n");

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    link.setAttribute("download", `WFH_Telemetry_Report_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const metrics = [
    {
      label: "Total Enrolled",
      value: totalCount,
      trend: "Cross-Platform",
      icon: "👥",
      iconStyle: { background: "var(--bg-input)", color: "var(--text-primary)" },
      valueColor: "var(--text-primary)",
      trendClass: "trend-up",
    },
    {
      label: "Active Workers",
      value: activeCount,
      trend: "Heartbeat < 3m",
      icon: "✓",
      iconStyle: { background: "var(--status-active-bg)", color: "var(--status-active)" },
      valueColor: "var(--status-active)",
      trendClass: "trend-up",
    },
    {
      label: "Idle Workers",
      value: idleCount,
      trend: "Check-in 3m–10m",
      icon: "◷",
      iconStyle: { background: "var(--status-idle-bg)", color: "var(--status-idle)" },
      valueColor: "var(--status-idle)",
      trendClass: "trend-down",
    },
    {
      label: "Offline Workers",
      value: offlineCount,
      trend: "Last seen > 10m",
      icon: "✕",
      iconStyle: { background: "var(--status-offline-bg)", color: "var(--status-offline)" },
      valueColor: "var(--status-offline)",
      trendClass: "trend-down",
    },
  ];

  return (
    <div className="app-shell">
      {/* Vanilla style overrides for new widgets */}
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-card {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          width: 92%;
          max-width: 820px;
          max-height: 85vh;
          overflow-y: auto;
          padding: 24px;
          position: relative;
          box-shadow: var(--shadow-lg), 0 0 30px rgba(173, 255, 65, 0.08);
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 16px;
          margin-bottom: 16px;
        }
        .modal-close {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 1.6rem;
          cursor: pointer;
          transition: color 0.2s;
        }
        .modal-close:hover {
          color: var(--text-primary);
        }
        .console-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .console-bar {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .console-select, .console-textarea {
          background: var(--bg-input);
          border: 1px solid var(--border-light);
          color: var(--text-primary);
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          outline: none;
          font-family: var(--font-sans);
          font-size: 0.85rem;
          transition: border-color 0.2s;
        }
        .console-select:focus, .console-textarea:focus {
          border-color: var(--accent);
        }
        .console-textarea {
          width: 100%;
          min-height: 100px;
          font-family: var(--font-mono);
          line-height: 1.5;
        }
        .console-terminal {
          background: #090909;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 16px;
          font-family: var(--font-mono);
          font-size: 0.82rem;
          color: #adff41;
          min-height: 240px;
          max-height: 450px;
          overflow-y: auto;
          white-space: pre-wrap;
          line-height: 1.6;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.8);
        }
        .console-btn {
          background: var(--accent);
          color: var(--text-inverse);
          border: none;
          padding: 10px 20px;
          border-radius: var(--radius-sm);
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.1s, opacity 0.2s;
        }
        .console-btn:hover {
          opacity: 0.9;
        }
        .console-btn:active {
          transform: scale(0.97);
        }
        .chart-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .chart-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .chart-title {
          font-weight: 700;
          font-size: 1rem;
          color: var(--text-primary);
        }
        .range-toggle-group {
          display: flex;
          background: var(--bg-input);
          border-radius: var(--radius-full);
          padding: 3px;
          border: 1px solid var(--border-subtle);
        }
        .range-toggle-btn {
          border: none;
          background: transparent;
          color: var(--text-secondary);
          padding: 5px 12px;
          font-size: 0.76rem;
          font-weight: 600;
          border-radius: var(--radius-full);
          cursor: pointer;
          transition: all 0.2s;
        }
        .range-toggle-btn.active {
          background: var(--bg-card);
          color: var(--accent-text);
          box-shadow: var(--shadow-sm);
        }
        .chart-svg-container {
          width: 100%;
          height: 200px;
          position: relative;
        }
        .onboarding-card {
          border: 2px dashed var(--border-medium);
          border-radius: var(--radius-lg);
          background: var(--bg-card);
          padding: 48px 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          max-width: 650px;
          margin: 40px auto;
        }
        .onboarding-steps {
          text-align: left;
          background: var(--bg-input);
          padding: 20px 24px;
          border-radius: var(--radius-md);
          width: 100%;
          border: 1px solid var(--border-subtle);
          font-size: 0.85rem;
          line-height: 1.7;
          font-family: var(--font-mono);
          color: var(--text-secondary);
        }
      `}</style>

      {/* Left Sidebar Icon Rail */}
      <aside className="sidebar">
        <div className="sidebar-logo" style={{ padding: 0, overflow: "hidden" }}>
          <Image
            src="/logo.jpeg"
            alt="Susalabs"
            width={44}
            height={44}
            style={{ objectFit: "contain", padding: "4px" }}
          />
        </div>
        <nav className="sidebar-nav">
          <button
            className={`sidebar-btn ${currentView === "dashboard" ? "active" : ""}`}
            onClick={() => setCurrentView("dashboard")}
            title="Overview Dashboard"
          >
            {/* Dashboard SVG Grid */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
          </button>

          <button
            className={`sidebar-btn ${currentView === "endpoints" ? "active" : ""}`}
            onClick={() => {
              setCurrentView("endpoints");
              setTopNavFilter("all");
            }}
            title="Monitored Endpoints"
          >
            {/* Workers Monitor SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>

          <button
            className={`sidebar-btn ${currentView === "osquery" ? "active" : ""}`}
            onClick={() => setCurrentView("osquery")}
            title="Osquery Interactive Console"
          >
            {/* Terminal Console SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>

          <button
            className={`sidebar-btn ${currentView === "charts" ? "active" : ""}`}
            onClick={() => setCurrentView("charts")}
            title="Telemetry Charts & Analytics"
          >
            {/* Bar Chart SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>

          <button
            className={`sidebar-btn ${currentView === "settings" ? "active" : ""}`}
            onClick={() => setCurrentView("settings")}
            title="Settings"
          >
            {/* Cog Settings SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-btn" onClick={toggleTheme} title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </aside>

      {/* Right Content Workspace */}
      <div className="content-area">
        {/* Top Header Navigation */}
        <header className="topnav">
          <div className="topnav-brand">
            <Image
              src="/logo.jpeg"
              alt="Susalabs"
              width={28}
              height={28}
              style={{ objectFit: "contain", borderRadius: "4px", flexShrink: 0 }}
            />
            <span>Susalabs WFH Telemetry</span>
          </div>

          {currentView === "endpoints" && (
            <div className="topnav-tabs">
              <button
                className={`topnav-tab ${topNavFilter === "all" ? "tab-active" : ""}`}
                onClick={() => setTopNavFilter("all")}
              >
                All Workers
              </button>
              <button
                className={`topnav-tab ${topNavFilter === "Active" ? "tab-active" : ""}`}
                onClick={() => setTopNavFilter("Active")}
              >
                Active
              </button>
              <button
                className={`topnav-tab ${topNavFilter === "Idle" ? "tab-active" : ""}`}
                onClick={() => setTopNavFilter("Idle")}
              >
                Idle
              </button>
              <button
                className={`topnav-tab ${topNavFilter === "Offline" ? "tab-active" : ""}`}
                onClick={() => setTopNavFilter("Offline")}
              >
                Offline
              </button>
            </div>
          )}

          <div className="topnav-actions">
            {currentUser && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginRight: "16px", borderRight: "1px solid var(--border-light)", paddingRight: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>{currentUser.email}</span>
                  <span style={{ fontSize: "0.68rem", color: "var(--accent-text)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {currentUser.role === "super_admin" ? "Super Admin" : "Admin"}
                  </span>
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "12px" }}>
              <span className="live-dot" />
              <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 500 }}>Live Telemetry</span>
            </div>
            <button className="topnav-icon-btn" onClick={toggleTheme} title="Toggle Dark/Light Mode">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>

            {/* ── Notification Bell ── */}
            <div style={{ position: "relative" }}>
              <button
                id="notif-bell-btn"
                className="topnav-icon-btn"
                title="Notifications"
                onClick={() => setNotifOpen(o => !o)}
                style={{ position: "relative" }}
              >
                🔔
                {/* Red badge — count of unread notifications */}
                {unreadCount > 0 && (
                  <span style={{
                    position: "absolute", top: "2px", right: "2px",
                    width: "16px", height: "16px",
                    background: "#ef4444", borderRadius: "50%",
                    fontSize: "0.6rem", fontWeight: 700,
                    color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1, pointerEvents: "none"
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    className="notif-dropdown"
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.18 }}
                    style={{
                      position: "absolute", top: "calc(100% + 10px)", right: 0,
                      width: "360px", maxHeight: "450px", overflowY: "auto",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: "var(--radius-lg)",
                      boxShadow: "var(--shadow-lg), 0 0 30px rgba(0,0,0,0.4)",
                      zIndex: 2000,
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Panel Header */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)"
                    }}>
                      <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>🔔 Notifications ({unreadCount})</span>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        {notifications.length > 0 && (
                          <>
                            <button
                              onClick={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-text)", fontSize: "0.7rem", fontWeight: 700, padding: 0 }}
                            >
                              Read All
                            </button>
                            <span style={{ color: "var(--border-medium)", fontSize: "0.8rem" }}>|</span>
                            <button
                              onClick={() => setNotifications([])}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.7rem", fontWeight: 700, padding: 0 }}
                            >
                              Clear
                            </button>
                            <span style={{ color: "var(--border-medium)", fontSize: "0.8rem" }}>|</span>
                          </>
                        )}
                        <button
                          onClick={() => setNotifOpen(false)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: "1.2rem", padding: 0, lineHeight: 1 }}
                        >×</button>
                      </div>
                    </div>

                    {/* Notification Items */}
                    <div style={{ padding: "4px 0", maxHeight: "320px", overflowY: "auto" }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                          🔔 No notifications yet.
                        </div>
                      ) : (
                        notifications.map(item => {
                          const icon = item.type === "offline" ? "🔴" : item.type === "idle" ? "💤" : "🟢";
                          const badgeBg = item.type === "offline" ? "rgba(239,68,68,0.15)" : item.type === "idle" ? "rgba(255,179,64,0.15)" : "rgba(173,255,65,0.1)";

                          // Relative time formatting
                          const getRelativeTime = (isoString: string) => {
                            try {
                              const diffMs = Date.now() - new Date(isoString).getTime();
                              const diffSecs = Math.floor(diffMs / 1000);
                              if (diffSecs < 10) return "just now";
                              if (diffSecs < 60) return `${diffSecs}s ago`;
                              const diffMins = Math.floor(diffSecs / 60);
                              if (diffMins < 60) return `${diffMins}m ago`;
                              const diffHours = Math.floor(diffMins / 60);
                              if (diffHours < 24) return `${diffHours}h ago`;
                              return new Date(isoString).toLocaleDateString();
                            } catch {
                              return "N/A";
                            }
                          };

                          return (
                            <div
                              key={item.id}
                              style={{
                                display: "flex", gap: "12px", alignItems: "flex-start",
                                padding: "12px 16px",
                                borderBottom: "1px solid var(--border-subtle)",
                                cursor: "pointer",
                                background: item.read ? "transparent" : "rgba(173,255,65,0.03)",
                                transition: "background 0.2s",
                              }}
                              onClick={() => {
                                setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
                                setInspectingNodeKey(item.nodeKey);
                                setNotifOpen(false);
                              }}
                            >
                              <span style={{
                                width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
                                background: badgeBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem"
                              }}>{icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: item.read ? 500 : 700, fontSize: "0.82rem", color: "var(--text-primary)" }}>
                                  {item.message}
                                </div>
                                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "3px", display: "flex", justifyContent: "space-between" }}>
                                  <span>{item.employeeName || item.hostname}</span>
                                  <span>{getRelativeTime(item.timestamp)}</span>
                                </div>
                              </div>
                              {!item.read && (
                                <span style={{
                                  width: "6px", height: "6px", borderRadius: "50%",
                                  background: "var(--accent)", marginTop: "6px", flexShrink: 0
                                }} />
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Panel Footer */}
                    <div style={{
                      padding: "10px 16px",
                      borderTop: "1px solid var(--border-subtle)",
                      display: "flex", justifyContent: "space-between", alignItems: "center"
                    }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        {hosts.length} endpoint{hosts.length !== 1 ? "s" : ""} monitored
                      </span>
                      <button
                        onClick={() => { setCurrentView("endpoints"); setNotifOpen(false); }}
                        style={{
                          fontSize: "0.72rem", fontWeight: 600,
                          color: "var(--accent-text)", background: "none", border: "none", cursor: "pointer"
                        }}
                      >
                        View all →
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div style={{ position: "relative" }}>
              <div
                className="topnav-avatar"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                {currentUser ? currentUser.email.substring(0, 2).toUpperCase() : "AD"}
              </div>
              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    className="profile-menu-dropdown"
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      width: "220px",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-lg), 0 4px 20px rgba(0,0,0,0.3)",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      zIndex: 1000,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
                      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {currentUser?.email || "sameer@susalabs.in"}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "var(--accent-text)", fontWeight: 700, textTransform: "uppercase", marginTop: "2px" }}>
                        {currentUser?.role === "super_admin" ? "Super Admin" : "Admin"}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setCurrentView("settings");
                        setUserMenuOpen(false);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-secondary)",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        textAlign: "left",
                        cursor: "pointer",
                        padding: "6px 0",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                      }}
                    >
                      ⚙️ Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      style={{
                        background: "rgba(239, 68, 68, 0.1)",
                        border: "1px solid rgba(239, 68, 68, 0.2)",
                        color: "#f87171",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        borderRadius: "var(--radius-sm)",
                        padding: "8px",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.2s"
                      }}
                    >
                      Log Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Views Router */}
        <div className="main-layout" style={{ overflowY: "auto" }}>

          {/* If there are NO hosts enrolled, display onboarding card on all views to make testing easy */}
          {totalCount === 0 && !loading && currentView !== "settings" ? (
            <div className="main-content" style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
              <div className="onboarding-card">
                {/* Modern Radar Icon */}
                <div style={{ position: "relative", width: "80px", height: "80px", background: "var(--accent-muted)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="live-dot" style={{ width: "24px", height: "24px" }} />
                </div>

                <h2>Awaiting Telemetry Stream</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", marginTop: "-8px" }}>
                  The Susalabs telemetry server has booted successfully. Currently, there are 0 endpoints registered. Please connect the client agent.
                </p>

                <div className="onboarding-steps">
                  <div style={{ color: "var(--accent)", fontWeight: "bold", marginBottom: "8px" }}>🚀 QUICK START TELEMETRY INSTRUCTIONS:</div>
                  <div>1. Open a PowerShell terminal.</div>
                  <div>2. Navigate to: C:\Projects\WFH_Tracker_System</div>
                  <div>3. Run command: <span style={{ color: "var(--text-primary)" }}>.\test-agent.ps1</span></div>
                  <div>4. The dashboard will automatically update with real-time logs!</div>
                </div>

                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                  Osquery TLS Endpoint monitoring active on port 3000
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ──────────────────────────────────────────────────────── */}
              {/* VIEW 1: Overview Dashboard */}
              {/* ──────────────────────────────────────────────────────── */}
              {currentView === "dashboard" && (
                <main className="main-content">
                  <div className="greeting">
                    <h1>Admin</h1>
                    <p>Susalabs Enterprise Osquery Telemetry Engine • Real-time Monitoring Overview</p>
                  </div>

                  {/* Metrics Grid */}
                  <section className="metrics-grid">
                    {metrics.map((m) => (
                      <div key={m.label} className="metric-card">
                        <div className="metric-card-header">
                          <div className="metric-card-icon" style={m.iconStyle}>
                            {m.icon}
                          </div>
                          <div className="metric-card-dots">•••</div>
                        </div>
                        <div className="metric-card-value" style={{ color: m.valueColor }}>
                          {m.value}
                        </div>
                        <div className="metric-card-label">{m.label}</div>
                        <span className={`metric-card-trend ${m.trendClass}`}>
                          {m.trend}
                        </span>
                      </div>
                    ))}
                  </section>

                  {/* Quick Activity Feed */}
                  <div className="card section-card">
                    <div className="section-title">
                      <span>📊</span>
                      <h2>Recent System Activity Logs (Real)</h2>
                    </div>
                    <div className="table-wrapper">
                      <table className="hosts-table">
                        <thead>
                          <tr>
                            <th>Host Profile</th>
                            <th>Delivered Table</th>
                            <th>Records Logged</th>
                            <th>Checking Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hosts.flatMap(h =>
                            (h.recentQueries || []).map((q) => ({
                              hostname: h.hostname,
                              employeeName: h.employeeName,
                              platform: h.platform,
                              queryName: q.queryName,
                              rowCount: q.rowCount,
                              timestamp: q.timestamp
                            }))
                          ).slice(0, 5).map((log, idx) => (
                            <tr key={idx}>
                              <td>
                                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                  <span className="platform-icon" style={{ width: "24px", height: "24px", fontSize: "0.78rem" }}>{getPlatformIcon(log.platform)}</span>
                                  <span style={{ fontWeight: 600 }}>{log.employeeName || log.hostname}</span>
                                </div>
                              </td>
                              <td style={{ fontFamily: "var(--font-mono)", color: "var(--accent-text)" }}>
                                {log.queryName}
                              </td>
                              <td>
                                <span className="query-log-badge">+{log.rowCount} rows</span>
                              </td>
                              <td style={{ color: "var(--text-secondary)" }}>
                                {formatTime(log.timestamp.toString())}
                              </td>
                            </tr>
                          ))}
                          {hosts.every(h => !h.recentQueries || h.recentQueries.length === 0) && (
                            <tr>
                              <td colSpan={4} style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                                Awaiting query log heartbeats...
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </main>
              )}

              {/* ──────────────────────────────────────────────────────── */}
              {/* VIEW 2: Workers Registry (Filterable Table) */}
              {/* ──────────────────────────────────────────────────────── */}
              {currentView === "endpoints" && (
                <main className="main-content">
                  <div className="card section-card">
                    {/* Filter bar */}
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div className="search-wrapper" style={{ flex: 1, minWidth: "200px" }}>
                        <span className="search-icon">🔍</span>
                        <input
                          id="host-search"
                          type="text"
                          placeholder="Search by employee, hostname..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="search-input"
                        />
                      </div>

                      {/* Platform Filter */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Platform</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {["all", "windows", "darwin"].map((p) => (
                            <button
                              key={p}
                              onClick={() => setPlatformFilter(p)}
                              style={{
                                padding: "5px 12px",
                                fontSize: "0.76rem",
                                fontWeight: 600,
                                border: "1px solid",
                                borderRadius: "var(--radius-full)",
                                cursor: "pointer",
                                transition: "all 0.18s",
                                borderColor: platformFilter === p ? "var(--accent)" : "var(--border-medium)",
                                background: platformFilter === p ? "var(--accent-muted)" : "transparent",
                                color: platformFilter === p ? "var(--accent-text)" : "var(--text-secondary)",
                              }}
                            >
                              {p === "all" ? "All OS" : p === "windows" ? "⊞ Windows" : "⌘ macOS"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Department Filter */}
                      {uniqueDepts.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Department</span>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              onClick={() => setDeptFilter("all")}
                              style={{
                                padding: "5px 12px", fontSize: "0.76rem", fontWeight: 600,
                                border: "1px solid", borderRadius: "var(--radius-full)", cursor: "pointer", transition: "all 0.18s",
                                borderColor: deptFilter === "all" ? "var(--accent)" : "var(--border-medium)",
                                background: deptFilter === "all" ? "var(--accent-muted)" : "transparent",
                                color: deptFilter === "all" ? "var(--accent-text)" : "var(--text-secondary)",
                              }}
                            >All Depts</button>
                            {uniqueDepts.map((dept) => (
                              <button
                                key={dept}
                                onClick={() => setDeptFilter(dept)}
                                style={{
                                  padding: "5px 12px", fontSize: "0.76rem", fontWeight: 600,
                                  border: "1px solid", borderRadius: "var(--radius-full)", cursor: "pointer", transition: "all 0.18s",
                                  borderColor: deptFilter === dept ? "var(--accent)" : "var(--border-medium)",
                                  background: deptFilter === dept ? "var(--accent-muted)" : "transparent",
                                  color: deptFilter === dept ? "var(--accent-text)" : "var(--text-secondary)",
                                }}
                              >🏢 {dept}</button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Status Filter */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {(["all", "Active", "Idle", "Offline"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => setTopNavFilter(s)}
                              style={{
                                padding: "5px 12px", fontSize: "0.76rem", fontWeight: 600,
                                border: "1px solid", borderRadius: "var(--radius-full)", cursor: "pointer", transition: "all 0.18s",
                                borderColor: topNavFilter === s
                                  ? s === "Active" ? "var(--status-active)" : s === "Idle" ? "var(--status-idle)" : s === "Offline" ? "var(--status-offline)" : "var(--accent)"
                                  : "var(--border-medium)",
                                background: topNavFilter === s
                                  ? s === "Active" ? "var(--status-active-bg)" : s === "Idle" ? "var(--status-idle-bg)" : s === "Offline" ? "var(--status-offline-bg)" : "var(--accent-muted)"
                                  : "transparent",
                                color: topNavFilter === s
                                  ? s === "Active" ? "var(--status-active)" : s === "Idle" ? "var(--status-idle)" : s === "Offline" ? "var(--status-offline)" : "var(--accent-text)"
                                  : "var(--text-secondary)",
                              }}
                            >
                              {s === "all" ? "All" : s}
                              {s !== "all" && (
                                <span style={{ marginLeft: "5px", fontSize: "0.7rem", opacity: 0.8 }}>
                                  ({s === "Active" ? activeCount : s === "Idle" ? idleCount : offlineCount})
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Reset Filters */}
                      {(platformFilter !== "all" || deptFilter !== "all" || topNavFilter !== "all" || searchTerm) && (
                        <button
                          onClick={() => { setPlatformFilter("all"); setDeptFilter("all"); setTopNavFilter("all"); setSearchTerm(""); }}
                          style={{
                            padding: "5px 12px", fontSize: "0.75rem", fontWeight: 600, marginTop: "16px",
                            border: "1px solid var(--border-medium)", borderRadius: "var(--radius-full)", cursor: "pointer",
                            background: "transparent", color: "var(--text-secondary)", transition: "all 0.18s"
                          }}
                        >✕ Reset Filters</button>
                      )}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "12px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                        Showing <strong style={{ color: "var(--text-primary)" }}>{filteredHosts.length}</strong> of {hosts.length} endpoints
                      </span>
                      {hosts.length > 0 && (
                        <button
                          onClick={exportToExcel}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 14px",
                            fontSize: "0.76rem",
                            fontWeight: 600,
                            borderRadius: "var(--radius-sm)",
                            background: "#107c41", // Excel green
                            color: "#ffffff",
                            border: "none",
                            cursor: "pointer",
                            boxShadow: "0 2px 4px rgba(16, 124, 65, 0.2)",
                            transition: "all 0.15s ease-in-out",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "0.9";
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.transform = "translateY(0)";
                          }}
                          title="Export all machines telemetry data to Excel (CSV)"
                        >
                          <span style={{ fontSize: "0.9rem" }}>📊</span> Export to Excel
                        </button>
                      )}
                    </div>

                    {loading ? (
                      <div className="loading-container">
                        <div className="loading-spinner" />
                        <span>Loading registry...</span>
                      </div>
                    ) : filteredHosts.length === 0 ? (
                      <div className="selection-pane-empty">
                        <span className="empty-icon">📭</span>
                        No matching endpoints found.
                      </div>
                    ) : (
                      <div className="table-wrapper">
                        <table className="hosts-table">
                          <thead>
                            <tr>
                              <th>Host Profile</th>
                              <th>Status</th>
                              <th>Last Heartbeat</th>
                              <th>Interval Delta</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            <AnimatePresence>
                              {filteredHosts.map((host) => (
                                <motion.tr
                                  key={host.nodeKey}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  onClick={() => setInspectingNodeKey(host.nodeKey)}
                                  title="Click row to inspect"
                                >
                                  <td>
                                    <div className="host-profile">
                                      <span className="platform-icon">
                                        {getPlatformIcon(host.platform)}
                                      </span>
                                      <div>
                                        <div className="host-name">{host.employeeName || host.hostname}</div>
                                        <div className="host-key">{host.employeeName ? host.hostname : host.nodeKey}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <span
                                      className={`status-badge ${host.status === "Active"
                                        ? "status-active"
                                        : host.status === "Idle"
                                          ? "status-idle"
                                          : "status-offline"
                                        }`}
                                    >
                                      {host.status}
                                    </span>
                                  </td>
                                  <td>{formatTime(host.lastHeartbeat)}</td>
                                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                                    {host.lastLogIntervalDeltaSeconds}s
                                  </td>
                                  <td>
                                    <button
                                      className="btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setInspectingNodeKey(host.nodeKey);
                                      }}
                                      style={{ padding: "5px 12px", fontSize: "0.73rem" }}
                                    >
                                      Inspect
                                    </button>
                                  </td>
                                </motion.tr>
                              ))}
                            </AnimatePresence>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </main>
              )}

              {/* ──────────────────────────────────────────────────────── */}
              {/* VIEW 3: SQL Terminal Console */}
              {/* ──────────────────────────────────────────────────────── */}
              {currentView === "osquery" && (
                <main className="main-content">
                  <div className="greeting">
                    <h1>Osquery Interactive Console</h1>
                    <p>Run SQL queries on active enrolled agent nodes to inspect live OS state.</p>
                  </div>

                  <div className="card section-card console-container">
                    <div className="console-bar">
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "bold" }}>TARGET WORKER NODE:</span>
                        <select
                          className="console-select"
                          value={consoleTargetHost}
                          onChange={(e) => setConsoleTargetHost(e.target.value)}
                        >
                          {hosts.length === 0 ? (
                            <option value="">No active workers available</option>
                          ) : (
                            hosts.map(h => (
                              <option key={h.nodeKey} value={h.nodeKey}>{h.employeeName || h.hostname} ({h.platform})</option>
                            ))
                          )}
                        </select>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: "200px" }}>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "bold" }}>QUICK TEMPLATES:</span>
                        <select
                          className="console-select"
                          onChange={(e) => setConsoleQuery(e.target.value)}
                        >
                          <option value="SELECT name, pid, path, resident_size FROM processes;">SELECT * FROM processes; (Processes Log)</option>
                          <option value="SELECT cpu_brand, physical_memory, free_memory FROM system_info join memory_info;">SELECT * FROM system_info; (Hardware Specifications)</option>
                          <option value="SELECT pid, local_address, local_port, remote_address, remote_port, state FROM listening_ports;">SELECT * FROM listening_ports; (Network Ports)</option>
                          <option value="SELECT name, data FROM registry WHERE path = 'HKEY_CURRENT_USER\Software\Susalabs\Activity';">SELECT * FROM registry; (User Activity Status)</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "bold" }}>SQL QUERY STATEMENT:</span>
                      <textarea
                        className="console-textarea"
                        value={consoleQuery}
                        onChange={(e) => setConsoleQuery(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="console-btn"
                        onClick={runConsoleQuery}
                        disabled={consoleLoading}
                      >
                        {consoleLoading ? "Executing SQL Query..." : "Execute Query on Host"}
                      </button>
                    </div>

                    <div>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "bold" }}>QUERY TERMINAL OUTPUT:</span>
                      <div className="console-terminal" style={{ overflowX: "auto" }}>
                        {consoleLoading ? (
                          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <div className="loading-spinner" style={{ width: "16px", height: "16px", border: "2px solid rgba(173, 255, 65, 0.2)", borderTopColor: "#adff41" }} />
                            <span>executing remote TLS shell query pack...</span>
                          </div>
                        ) : consoleError ? (
                          <div style={{ color: "#ef4444" }}>{consoleError}</div>
                        ) : consoleResult ? (
                          <div>
                            <div>-- Executed on: {(() => {
                              const target = hosts.find(h => h.nodeKey === consoleTargetHost);
                              return target ? (target.employeeName || target.hostname) : "Unknown";
                            })()}</div>
                            <div>-- Execution Time: {new Date().toLocaleTimeString()}</div>
                            <div>-- Rows Returned: {consoleResult.length}</div>
                            <pre style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "0.78rem",
                              lineHeight: "1.4",
                              margin: "12px 0 0 0",
                              overflowX: "auto",
                              whiteSpace: "pre"
                            }}>
                              {formatAsAsciiTable(consoleResult)}
                            </pre>
                          </div>
                        ) : (
                          <div>Ready. Select a target worker and execute an Osquery query pack.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </main>
              )}

              {/* ──────────────────────────────────────────────────────── */}
              {/* VIEW 4: Charts & Analytics (30d/7d/Today) */}
              {/* ──────────────────────────────────────────────────────── */}
              {currentView === "charts" && (
                <main className="main-content">
                  <div className="greeting">
                    <h1>Telemetry charts & analytics</h1>
                    <p>Real-time telemetry log volumes, compliance trends, and check-in history charts.</p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>

                    {/* CHART 1: Telemetry Volume Line Graph */}
                    <div className="chart-card">
                      <div className="chart-header">
                        <div className="chart-title">Telemetry log volume (Delivered Rows)</div>
                        <div className="range-toggle-group">
                          <button className={`range-toggle-btn ${chartRange === "today" ? "active" : ""}`} onClick={() => setChartRange("today")}>Today</button>
                          <button className={`range-toggle-btn ${chartRange === "7d" ? "active" : ""}`} onClick={() => setChartRange("7d")}>7 Days</button>
                          <button className={`range-toggle-btn ${chartRange === "30d" ? "active" : ""}`} onClick={() => setChartRange("30d")}>30 Days</button>
                        </div>
                      </div>

                      <div className="chart-svg-container">
                        {/* Custom SVG Line Chart */}
                        <svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#adff41" stopOpacity="0.4" />
                              <stop offset="100%" stopColor="#adff41" stopOpacity="0.0" />
                            </linearGradient>
                            <filter id="glow">
                              <feGaussianBlur stdDeviation="3" result="blur" />
                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                          </defs>

                          {/* Grid Lines */}
                          <line x1="0" y1="50" x2="400" y2="50" stroke="var(--border-subtle)" strokeDasharray="4" />
                          <line x1="0" y1="100" x2="400" y2="100" stroke="var(--border-subtle)" strokeDasharray="4" />
                          <line x1="0" y1="150" x2="400" y2="150" stroke="var(--border-subtle)" strokeDasharray="4" />

                          {/* Filled area */}
                          {chartRange === "today" ? (
                            <path d="M 0 170 Q 100 130 200 90 T 400 60 L 400 200 L 0 200 Z" fill="url(#chartGrad)" />
                          ) : chartRange === "7d" ? (
                            <path d="M 0 160 Q 80 140 160 110 T 320 80 T 400 40 L 400 200 L 0 200 Z" fill="url(#chartGrad)" />
                          ) : (
                            <path d="M 0 180 Q 50 150 150 130 T 300 70 T 400 30 L 400 200 L 0 200 Z" fill="url(#chartGrad)" />
                          )}

                          {/* Line */}
                          {chartRange === "today" ? (
                            <path d="M 0 170 Q 100 130 200 90 T 400 60" fill="none" stroke="#adff41" strokeWidth="3" filter="url(#glow)" />
                          ) : chartRange === "7d" ? (
                            <path d="M 0 160 Q 80 140 160 110 T 320 80 T 400 40" fill="none" stroke="#adff41" strokeWidth="3" filter="url(#glow)" />
                          ) : (
                            <path d="M 0 180 Q 50 150 150 130 T 300 70 T 400 30" fill="none" stroke="#adff41" strokeWidth="3" filter="url(#glow)" />
                          )}
                        </svg>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                        <span>{chartRange === "today" ? "00:00" : chartRange === "7d" ? "6 Days Ago" : "30 Days Ago"}</span>
                        <span>{chartRange === "today" ? "12:00" : chartRange === "7d" ? "3 Days Ago" : "15 Days Ago"}</span>
                        <span>Now</span>
                      </div>
                    </div>

                    {/* CHART 2: Worker Check-ins Frequency */}
                    <div className="chart-card">
                      <div className="chart-header">
                        <div className="chart-title">Check-in heartbeats frequency</div>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Total Logs Sent</span>
                      </div>

                      <div className="chart-svg-container" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", paddingBottom: "10px" }}>
                        {/* Render simple HTML/CSS bar graph for ease and high fidelity */}
                        {hosts.map((h) => {
                          const totalLogs = h.recentQueries?.reduce((acc, q) => acc + q.rowCount, 0) || 10;
                          const heightPct = Math.min(100, Math.max(15, (totalLogs / 500) * 100));
                          return (
                            <div key={h.nodeKey} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flex: 1 }}>
                              <span style={{ fontSize: "0.72rem", fontWeight: "bold", color: "var(--accent)" }}>{totalLogs}</span>
                              <div style={{
                                width: "24px",
                                height: `${heightPct}px`,
                                background: "linear-gradient(to top, var(--accent-muted), var(--accent))",
                                borderRadius: "4px 4px 0 0",
                                boxShadow: "0 0 10px rgba(173, 255, 65, 0.3)"
                              }} />
                              <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)", maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.employeeName || h.hostname}>
                                {h.employeeName || h.hostname}
                              </span>
                            </div>
                          );
                        })}
                        {hosts.length === 0 && (
                          <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", width: "100%", textAlign: "center", paddingBottom: "40px" }}>
                            Awaiting checks for statistics...
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CHART 3: Platform Ratio Donut Chart */}
                    <div className="chart-card">
                      <div className="chart-title">OS platforms distribution</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "40px", padding: "10px 0" }}>
                        <svg width="120" height="120" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--bg-input)" strokeWidth="4" />
                          {/* Render portions based on platforms */}
                          {totalCount > 0 ? (
                            (() => {
                              const winCount = hosts.filter(h => h.platform === "windows").length;
                              const macCount = hosts.filter(h => h.platform === "darwin").length;
                              const winPct = (winCount / totalCount) * 100;
                              const macPct = (macCount / totalCount) * 100;
                              return (
                                <>
                                  <circle cx="18" cy="18" r="15.915" fill="none" stroke="#adff41" strokeWidth="4"
                                    strokeDasharray={`${winPct} ${100 - winPct}`} strokeDashoffset="25" />
                                  {macCount > 0 && (
                                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--text-secondary)" strokeWidth="4"
                                      strokeDasharray={`${macPct} ${100 - macPct}`} strokeDashoffset={25 - winPct} />
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--border-subtle)" strokeWidth="4" />
                          )}
                        </svg>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#adff41" }} />
                            <div>
                              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Windows Nodes</span>
                              <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
                                {hosts.filter(h => h.platform === "windows").length} workers ({totalCount > 0 ? Math.round((hosts.filter(h => h.platform === "windows").length / totalCount) * 100) : 0}%)
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: "var(--text-secondary)" }} />
                            <div>
                              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>macOS Nodes</span>
                              <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
                                {hosts.filter(h => h.platform === "darwin").length} workers ({totalCount > 0 ? Math.round((hosts.filter(h => h.platform === "darwin").length / totalCount) * 100) : 0}%)
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* CHART 4: Telemetry Compliance Stats */}
                    <div className="chart-card">
                      <div className="chart-title">Node state compliance status</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "6px" }}>
                            <span>Active System Health (Target &lt;3m check-in)</span>
                            <span style={{ fontWeight: 600, color: "var(--status-active)" }}>{totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0}%</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "var(--bg-input)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${totalCount > 0 ? (activeCount / totalCount) * 100 : 0}%`, height: "100%", background: "var(--status-active)" }} />
                          </div>
                        </div>

                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "6px" }}>
                            <span>Idle System Health (Laptop sleeps/locked)</span>
                            <span style={{ fontWeight: 600, color: "var(--status-idle)" }}>{totalCount > 0 ? Math.round((idleCount / totalCount) * 100) : 0}%</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "var(--bg-input)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${totalCount > 0 ? (idleCount / totalCount) * 100 : 0}%`, height: "100%", background: "var(--status-idle)" }} />
                          </div>
                        </div>

                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "6px" }}>
                            <span>Offline System Health (Agent unreachable)</span>
                            <span style={{ fontWeight: 600, color: "var(--status-offline)" }}>{totalCount > 0 ? Math.round((offlineCount / totalCount) * 100) : 0}%</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "var(--bg-input)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${totalCount > 0 ? (offlineCount / totalCount) * 100 : 0}%`, height: "100%", background: "var(--status-offline)" }} />
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </main>
              )}

              {/* ──────────────────────────────────────────────────────── */}
              {/* VIEW 5: Settings Page */}
              {/* ──────────────────────────────────────────────────────── */}
              {currentView === "settings" && (
                <main className="main-content">
                  <div className="greeting">
                    <h1>Administrator Settings</h1>
                    <p>Configure telemetry reporting intervals, log arrival frequencies, data retention duration, and manage administrators.</p>
                  </div>

                  <div className="card section-card" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

                    {settingsStatus && (
                      <div style={{
                        padding: "12px 16px",
                        borderRadius: "var(--radius-sm)",
                        background: settingsStatus.startsWith("success") ? "rgba(173, 255, 65, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        color: settingsStatus.startsWith("success") ? "var(--accent)" : "#ef4444",
                        border: `1px solid ${settingsStatus.startsWith("success") ? "var(--status-active)" : "#ef4444"}`,
                        fontSize: "0.85rem",
                        fontWeight: 600
                      }}>
                        {settingsStatus.substring(settingsStatus.indexOf(":") + 2)}
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

                      {/* Global Settings Section */}
                      <div style={{
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-lg)",
                        padding: "20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        maxWidth: "600px",
                        margin: "0 auto",
                        width: "100%"
                      }}>
                        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border-medium)", paddingBottom: "12px" }}>
                          <span style={{ fontSize: "1.2rem" }}>⚙️</span> Global Telemetry & Policy
                        </h3>

                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Logs Arrival Frequency</span>
                            <select
                              className="console-select"
                              value={settings.logIntervalMinutes}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setSettings({
                                  ...settings,
                                  logIntervalMinutes: val
                                });
                              }}
                            >
                              <option value={1}>1 Minute (Testing)</option>
                              <option value={5}>5 Minutes</option>
                              <option value={10}>10 Minutes</option>
                              <option value={15}>15 Minutes</option>
                              <option value={30}>30 Minutes</option>
                              <option value={60}>60 Minutes (1 Hour)</option>
                            </select>
                          </div>
                          <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>Select how frequently the endpoint agent sends monitoring logs to the server.</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Data Retention Period</span>
                            <select
                              className="console-select"
                              value={settings.dataRetentionDays}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                setSettings({
                                  ...settings,
                                  dataRetentionDays: val
                                });
                              }}
                            >
                              <option value={7}>7 Days</option>
                              <option value={14}>14 Days</option>
                              <option value={20}>20 Days</option>
                              <option value={30}>30 Days</option>
                              <option value={60}>60 Days</option>
                              <option value={90}>90 Days</option>
                            </select>
                          </div>
                          <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>Duration for keeping telemetry log documents on the system.</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Retention Clean Action</span>
                            <select
                              className="console-select"
                              value={settings.retentionAction}
                              onChange={(e) => {
                                const val = e.target.value as "delete" | "archive";
                                setSettings({
                                  ...settings,
                                  retentionAction: val
                                });
                              }}
                            >
                              <option value="delete">Delete Permanently</option>
                              <option value="archive">Archive Logs</option>
                            </select>
                          </div>
                          <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>Whether logs should be permanently purged or flagged as archived.</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border-medium)", paddingTop: "16px" }}>
                      <button
                        className="console-btn"
                        onClick={() => handleSaveSettings(settings)}
                        disabled={settingsSaving}
                      >
                        {settingsSaving ? "Saving Configuration..." : "Save Configuration"}
                      </button>
                    </div>
                  </div>

                  {currentUser?.role === "super_admin" && (
                    <div className="card section-card" style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "24px" }}>
                      <div className="section-header">
                        <div className="section-title">
                          <span>👥</span> Admin Management Settings
                        </div>
                        <button
                          className="console-btn"
                          onClick={() => setShowCreateAdminModal(true)}
                          style={{ padding: "8px 16px", fontSize: "0.8rem" }}
                        >
                          + Create New Admin
                        </button>
                      </div>

                      <div className="table-wrapper">
                        <table className="hosts-table" style={{ fontSize: "0.82rem" }}>
                          <thead>
                            <tr>
                              <th>Admin Email</th>
                              <th>Assigned Machines</th>
                              <th>Created At</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminsList.length === 0 ? (
                              <tr>
                                <td colSpan={4} style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)" }}>
                                  No additional administrators created yet.
                                </td>
                              </tr>
                            ) : (
                              adminsList.map((adm) => (
                                <tr key={adm._id}>
                                  <td style={{ fontWeight: 600, color: "var(--accent-text)" }}>{adm.email}</td>
                                  <td>
                                    {adm.assignedMachines && adm.assignedMachines.length > 0 ? (
                                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                        {adm.assignedMachines.map((m: string) => (
                                          <span key={m} style={{
                                            fontSize: "0.7rem", fontWeight: 600, padding: "2px 8px",
                                            background: "var(--bg-input)", border: "1px solid var(--border-medium)",
                                            borderRadius: "var(--radius-full)", color: "var(--text-primary)"
                                          }}>{m}</span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>All Machines (None assigned)</span>
                                    )}
                                  </td>
                                  <td>{new Date(adm.createdAt).toLocaleDateString()}</td>
                                  <td>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                      <button
                                        onClick={() => setEditingAdmin(adm)}
                                        style={{ background: "none", border: "none", color: "var(--accent-text)", fontWeight: 600, cursor: "pointer", padding: 0 }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={async () => {
                                          if (confirm(`Are you sure you want to delete admin ${adm.email}?`)) {
                                            const res = await fetch(`/api/admin/users/${adm._id}`, { method: "DELETE" });
                                            if (res.ok) {
                                              fetchAdmins();
                                            }
                                          }
                                        }}
                                        style={{ background: "none", border: "none", color: "#f87171", fontWeight: 600, cursor: "pointer", padding: 0 }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </main>
              )}
            </>
          )}

        </div>
      </div>

      {/* ──────────────────────────────────────────────────────── */}
      {/* OVERLAY MODAL: Host Telemetry Inspector */}
      {/* ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {inspectingHost && displayHost && (
          <div className="modal-overlay" onClick={() => setInspectingNodeKey(null)}>
            <motion.div
              className="modal-card"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className="platform-icon" style={{ fontSize: "1.2rem", width: "40px", height: "40px" }}>
                    {getPlatformIcon(displayHost.platform)}
                  </span>
                  <div>
                    <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                      {displayHost.employeeName || displayHost.hostname}
                      <span className={`status-badge ${displayHost.status === "Active"
                        ? "status-active"
                        : displayHost.status === "Idle"
                          ? "status-idle"
                          : "status-offline"
                        }`} style={{ fontSize: "0.64rem", padding: "2px 8px" }}>
                        {displayHost.status}
                      </span>
                    </h2>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      Node Key: {displayHost.nodeKey}
                    </span>
                    {/* Employee detail pills */}
                    {(displayHost.employeeId || displayHost.email || displayHost.department) && (
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                        {displayHost.employeeId && (
                          <span style={{
                            fontSize: "0.7rem", fontWeight: 600, padding: "2px 10px",
                            background: "var(--bg-input)", border: "1px solid var(--border-medium)",
                            borderRadius: "var(--radius-full)", color: "var(--accent-text)",
                            fontFamily: "var(--font-mono)"
                          }}>🪪 {displayHost.employeeId}</span>
                        )}
                        {displayHost.department && (
                          <span style={{
                            fontSize: "0.7rem", fontWeight: 600, padding: "2px 10px",
                            background: "var(--bg-input)", border: "1px solid var(--border-medium)",
                            borderRadius: "var(--radius-full)", color: "var(--text-primary)"
                          }}>🏢 {displayHost.department}</span>
                        )}
                        {displayHost.email && (
                          <span style={{
                            fontSize: "0.7rem", fontWeight: 600, padding: "2px 10px",
                            background: "var(--bg-input)", border: "1px solid var(--border-medium)",
                            borderRadius: "var(--radius-full)", color: "var(--text-secondary)"
                          }}>📧 {displayHost.email}</span>
                        )}
                        {displayHost.hostname && displayHost.employeeName && (
                          <span style={{
                            fontSize: "0.7rem", fontWeight: 600, padding: "2px 10px",
                            background: "var(--bg-input)", border: "1px solid var(--border-medium)",
                            borderRadius: "var(--radius-full)", color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)"
                          }}>💻 {displayHost.hostname}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button className="modal-close" onClick={() => setInspectingNodeKey(null)}>×</button>
              </div>

              {/* Main Content Area */}
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

                {/* Device Specifications Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                  <div className="detail-panel">
                    <span className="sidebar-label" style={{ fontSize: "0.68rem" }}>Operating System</span>
                    <div className="sidebar-value" style={{ fontSize: "0.92rem", marginTop: "2px" }}>
                      {displayHost.latestResults?.["system_performance"]?.[0]?.os_name ||
                        (displayHost.platform === "unknown" ? "Unknown" : displayHost.platform === "darwin" ? "macOS" : "Windows")}
                    </div>
                  </div>
                  <div className="detail-panel">
                    <span className="sidebar-label" style={{ fontSize: "0.68rem" }}>Input Activity (KB/Mouse)</span>
                    <div className="sidebar-value" style={{ fontSize: "0.92rem", marginTop: "2px" }}>
                      {(() => {
                        const activity = displayHost.latestResults?.["user_activity"];
                        if (!activity) return <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>No telemetry</span>;
                        const status = activity.find(r => r.name === "ActiveStatus")?.data || "Active";
                        const idleSecs = activity.find(r => r.name === "IdleSeconds")?.data;
                        if (status === "Active") {
                          return <span style={{ color: "var(--status-active)", fontWeight: 600 }}>Active</span>;
                        } else {
                          return <span style={{ color: "var(--status-idle)", fontWeight: 600 }}>Idle {idleSecs ? `(${idleSecs}s)` : ""}</span>;
                        }
                      })()}
                    </div>
                  </div>
                  <div className="detail-panel">
                    <span className="sidebar-label" style={{ fontSize: "0.68rem" }}>Last Transmission</span>
                    <div className="sidebar-value" style={{ fontSize: "0.92rem", marginTop: "2px" }}>
                      {formatTime(displayHost.lastHeartbeat)}
                    </div>
                  </div>
                  <div className="detail-panel">
                    <span className="sidebar-label" style={{ fontSize: "0.68rem" }}>Delta check-in</span>
                    <div className="sidebar-value" style={{ fontSize: "0.92rem", marginTop: "2px" }}>
                      {selectedDate === todayStr ? `${displayHost.lastLogIntervalDeltaSeconds}s ago` : "N/A (Historical)"}
                    </div>
                  </div>
                </div>

                {/* Date Selector for Historical Telemetry */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "var(--bg-input)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-medium)",
                  marginTop: "4px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>📅 Telemetry Date:</span>
                    <input
                      type="date"
                      value={selectedDate}
                      max={todayStr}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-light)",
                        color: "var(--text-primary)",
                        padding: "6px 12px",
                        borderRadius: "var(--radius-sm)",
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.85rem",
                        outline: "none"
                      }}
                    />
                    {selectedDate !== todayStr && (
                      <span className="status-badge status-idle" style={{ fontSize: "0.68rem", padding: "2px 8px", background: "rgba(255, 179, 64, 0.15)", color: "var(--status-idle)" }}>
                        📜 Historical View
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {historyLoading && (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="live-dot" style={{ background: "var(--status-idle)", width: "8px", height: "8px" }} /> Loading history...
                      </span>
                    )}
                    {historyError && (
                      <span style={{ fontSize: "0.8rem", color: "var(--status-offline)" }}>
                        ⚠️ {historyError}
                      </span>
                    )}
                  </div>
                </div>

                {/* Modal Tab Headers */}
                <div className="tab-group" style={{ background: "var(--bg-input)" }}>
                  <button
                    className={`tab-btn ${activeTab === "processes" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("processes")}
                  >
                    Running Processes
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "history" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("history")}
                  >
                    🌐 Browser & Windows
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "network" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("network")}
                  >
                    Network Sockets
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "logs" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("logs")}
                  >
                    Checkin Logs
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "activity" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("activity")}
                  >
                    Keyboard & Mouse
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "timeline" ? "tab-active" : ""}`}
                    onClick={() => setActiveTab("timeline")}
                  >
                    📅 Work Timeline
                  </button>
                </div>

                {/* Tab content elements */}
                <div style={{ minHeight: "240px" }}>

                  {/* TAB 1: Processes list */}
                  {activeTab === "processes" && (
                    <div>
                      <div className="detail-section-label">Real Active Applications & Background Processes</div>
                      {displayHost.latestResults?.["running_processes"] ? (
                        <div className="table-wrapper" style={{ maxHeight: "300px", overflowY: "auto" }}>
                          <table className="hosts-table" style={{ fontSize: "0.78rem" }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                              <tr>
                                <th>Process Name</th>
                                <th>PID</th>
                                <th>Memory Size</th>
                                <th>Executable Path</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayHost.latestResults["running_processes"].map((proc, idx) => (
                                <tr key={idx}>
                                  <td style={{ fontWeight: 600, color: "var(--accent-text)" }}>{proc.name || "N/A"}</td>
                                  <td style={{ fontFamily: "var(--font-mono)" }}>{proc.pid || "N/A"}</td>
                                  <td>{formatBytesToMB(proc.resident_size)}</td>
                                  <td style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                                    {proc.path || "N/A"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="selection-pane-empty" style={{ padding: "40px" }}>
                          <span className="empty-icon">📋</span>
                          Awaiting process list logs... (Run test simulation agent to send log stream)
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: Browser & Windows */}
                  {activeTab === "history" && (
                    <div>
                      {/* Sub-tab Switcher */}
                      <div className="tab-group" style={{ background: "var(--bg-input)", marginBottom: "16px", maxWidth: "450px" }}>
                        <button
                          className={`tab-btn ${subTab === "windows" ? "tab-active" : ""}`}
                          onClick={() => setSubTab("windows")}
                        >
                          🖥️ Active Windows (Incognito & Normal)
                        </button>
                        <button
                          className={`tab-btn ${subTab === "browser" ? "tab-active" : ""}`}
                          onClick={() => setSubTab("browser")}
                        >
                          🌐 Browser History Database
                        </button>
                      </div>

                      {subTab === "windows" && (
                        <div>
                          <div className="detail-section-label">Active App Window Logs (Incognito & Normal Mode Tracker)</div>
                          {(() => {
                            const rawEvents = displayHost.latestResults?.["window_history"] || [];

                            if (rawEvents.length === 0) {
                              return (
                                <div className="selection-pane-empty" style={{ padding: "40px" }}>
                                  <span className="empty-icon">🖥️</span>
                                  No active window logs recorded yet.
                                </div>
                              );
                            }

                            // Parse events
                            const parsedEvents = rawEvents.map((item) => {
                              const details = item.details || "";
                              const firstPipe = details.indexOf("|");
                              const process = firstPipe > -1 ? details.substring(0, firstPipe) : details;

                              let title = "";
                              let url = "";
                              const remaining = firstPipe > -1 ? details.substring(firstPipe + 1) : "";
                              const urlIndex = remaining.indexOf("|URL:");
                              if (urlIndex > -1) {
                                title = remaining.substring(0, urlIndex);
                                url = remaining.substring(urlIndex + 5);
                              } else {
                                title = remaining;
                              }
                              return {
                                timestamp: item.timestamp,
                                process,
                                title,
                                url
                              };
                            });

                            // Sort ascending to calculate duration
                            const sortedAsc = [...parsedEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                            // Calculate duration
                            const eventsWithDuration = sortedAsc.map((event, idx) => {
                              let durationSec = 0;
                              if (idx < sortedAsc.length - 1) {
                                const currentMs = new Date(event.timestamp).getTime();
                                const nextMs = new Date(sortedAsc[idx + 1].timestamp).getTime();
                                durationSec = Math.max(0, Math.round((nextMs - currentMs) / 1000));
                              } else {
                                const currentMs = new Date(event.timestamp).getTime();
                                const referenceMs = new Date(displayHost.lastHeartbeat).getTime();
                                durationSec = Math.max(0, Math.round((referenceMs - currentMs) / 1000));
                              }
                              return { ...event, durationSec };
                            });

                            // Sort back to descending for display
                            const displayEvents = [...eventsWithDuration].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                            const formatDuration = (secs: number) => {
                              if (secs <= 0) return "< 2s";
                              if (secs < 60) return `${secs}s`;
                              const mins = Math.floor(secs / 60);
                              const remSecs = secs % 60;
                              if (mins < 60) return `${mins}m ${remSecs}s`;
                              const hours = Math.floor(mins / 60);
                              const remMins = mins % 60;
                              return `${hours}h ${remMins}m`;
                            };

                            const formatTimeLocal = (tsStr: string) => {
                              try {
                                const date = new Date(tsStr);
                                if (isNaN(date.getTime())) return "N/A";
                                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                              } catch {
                                return "N/A";
                              }
                            };

                            return (
                              <div className="table-wrapper" style={{ maxHeight: "300px", overflowY: "auto" }}>
                                <table className="hosts-table" style={{ fontSize: "0.78rem" }}>
                                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                    <tr>
                                      <th>Time</th>
                                      <th>Application</th>
                                      <th>URL / Window Title</th>
                                      <th>Duration</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {displayEvents.map((item, idx) => (
                                      <tr key={idx}>
                                        <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                                          {formatTimeLocal(item.timestamp)}
                                        </td>
                                        <td>
                                          <span className="status-badge status-active" style={{ fontSize: "0.65rem", padding: "2px 8px", background: "var(--accent-muted)", color: "var(--accent-text)", border: "1px solid var(--border-focus)" }}>
                                            {item.process}
                                          </span>
                                        </td>
                                        <td style={{ maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {item.url ? (
                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)", textDecoration: "underline", fontWeight: 600 }} title={item.url}>
                                                {item.url}
                                              </a>
                                              {item.title && (
                                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }} title={item.title}>
                                                  {item.title}
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <span style={{ fontWeight: 600, color: "var(--text-primary)" }} title={item.title}>
                                              {item.title || "Untitled Window"}
                                            </span>
                                          )}
                                        </td>
                                        <td style={{ whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                                          {formatDuration(item.durationSec)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {subTab === "browser" && (
                        <div>
                          <div className="detail-section-label">Recent Browser History (Chrome & Edge Copies)</div>
                          {(() => {
                            const chromeHist = displayHost.latestResults?.["chrome_history"] || [];
                            const edgeHist = displayHost.latestResults?.["edge_history"] || [];

                            // Combine history and sort by last_visit_time descending
                            const combinedHist = ([
                              ...chromeHist.map(h => ({ ...h, browser: "Chrome" })),
                              ...edgeHist.map(h => ({ ...h, browser: "Edge" }))
                            ] as Record<string, string>[]).sort((a, b) => {
                              const timeA = parseInt(a.last_visit_time || "0", 10);
                              const timeB = parseInt(b.last_visit_time || "0", 10);
                              return timeB - timeA;
                            });

                            if (combinedHist.length === 0) {
                              return (
                                <div className="selection-pane-empty" style={{ padding: "40px" }}>
                                  <span className="empty-icon">🌐</span>
                                  No browser history recorded yet.
                                </div>
                              );
                            }

                            // Helper to format Chrome/Edge Windows/WebKit microsecond timestamp
                            const formatChromeTime = (tsStr: string) => {
                              try {
                                const ts = parseInt(tsStr, 10);
                                if (!ts || ts === 0) return "N/A";
                                // Convert to milliseconds, subtract offset
                                const ms = Math.floor(ts / 1000 - 11644473600000);
                                const date = new Date(ms);
                                // Check if valid date
                                if (isNaN(date.getTime())) return "N/A";
                                return date.toLocaleString();
                              } catch {
                                return "N/A";
                              }
                            };

                            return (
                              <div className="table-wrapper" style={{ maxHeight: "300px", overflowY: "auto" }}>
                                <table className="hosts-table" style={{ fontSize: "0.78rem" }}>
                                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                    <tr>
                                      <th>Browser</th>
                                      <th>Title</th>
                                      <th>URL</th>
                                      <th>Visit Time</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {combinedHist.map((item, idx) => (
                                      <tr key={idx}>
                                        <td>
                                          <span className={`status-badge ${item.browser === "Chrome" ? "status-active" : "status-idle"}`} style={{ fontSize: "0.65rem", padding: "2px 8px" }}>
                                            {item.browser}
                                          </span>
                                        </td>
                                        <td style={{ fontWeight: 600, color: "var(--text-primary)", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.title}>
                                          {item.title || "Untitled"}
                                        </td>
                                        <td style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.url}>
                                          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
                                            {item.url}
                                          </a>
                                        </td>
                                        <td style={{ whiteSpace: "nowrap" }}>
                                          {formatChromeTime(item.last_visit_time)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: Network Listening Ports */}
                  {activeTab === "network" && (
                    <div>
                      <div className="detail-section-label">Real Listening Network Socket connections</div>

                      {/* Hardware Specs Row */}
                      {displayHost.latestResults?.["system_performance"] && (
                        <div style={{
                          display: "flex",
                          gap: "16px",
                          marginBottom: "16px",
                          padding: "12px 16px",
                          background: "var(--bg-input)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-light)",
                          fontSize: "0.82rem"
                        }}>
                          {displayHost.latestResults["system_performance"].map((spec, idx) => (
                            <div key={idx} style={{ display: "flex", gap: "16px", alignItems: "center", width: "100%" }}>
                              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>💻 CPU:</span>
                                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{spec.cpu_brand || "Intel/AMD"}</span>
                              </div>
                              <div style={{ width: "1px", height: "14px", background: "var(--border-medium)" }} />
                              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>🧠 RAM:</span>
                                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                  {spec.physical_memory ? `${Math.round(parseInt(spec.physical_memory, 10) / (1024 * 1024 * 1024))} GB` : "N/A"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {displayHost.latestResults?.["active_network_sockets"] ? (
                        <div className="table-wrapper" style={{ maxHeight: "300px", overflowY: "auto" }}>
                          <table className="hosts-table" style={{ fontSize: "0.78rem" }}>
                            <thead>
                              <tr>
                                <th>PID</th>
                                <th>Local Address</th>
                                <th>Local Port</th>
                                <th>Remote Address</th>
                                <th>Remote Port</th>
                                <th>State</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayHost.latestResults["active_network_sockets"].map((sock, idx) => (
                                <tr key={idx}>
                                  <td style={{ fontFamily: "var(--font-mono)" }}>{sock.pid || "N/A"}</td>
                                  <td>{sock.local_address || "0.0.0.0"}</td>
                                  <td style={{ fontWeight: 600 }}>{sock.local_port || "N/A"}</td>
                                  <td>{sock.remote_address || "*"}</td>
                                  <td>{sock.remote_port || "*"}</td>
                                  <td>
                                    <span className="status-badge status-active" style={{ fontSize: "0.65rem", padding: "2px 8px" }}>
                                      {sock.state || "LISTEN"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="selection-pane-empty" style={{ padding: "40px" }}>
                          <span className="empty-icon">🌐</span>
                          No active network socket log stream received.
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 4: Check-in Logs */}
                  {activeTab === "logs" && (
                    <div>
                      <div className="detail-section-label">Log Check-in History Stream (Real) - Data arrives every {settings.logIntervalMinutes} minutes</div>

                      {displayHost.latestCheckinDebug && (
                        <div className="detail-panel" style={{
                          marginBottom: "16px",
                          border: "1px dashed var(--border-medium)",
                          padding: "16px",
                          borderRadius: "8px",
                          backgroundColor: "var(--bg-light)",
                          fontFamily: "monospace",
                          fontSize: "0.85rem",
                          lineHeight: "1.5"
                        }}>
                          <div style={{ marginTop: "8px", paddingTop: "8px" }}>
                            <strong>Completeness Status:</strong> <span style={{
                              fontWeight: 700,
                              color: displayHost.latestCheckinDebug.completeness.includes("PROPER") ? "var(--accent-green)" : "var(--accent-orange)"
                            }}>{displayHost.latestCheckinDebug.completeness}</span>
                          </div>
                          {displayHost.latestCheckinDebug.rateLimitedDroppedCount > 0 && (
                            <div style={{ color: "var(--accent-orange)", marginTop: "4px" }}>
                              ⚠️ <strong>Rate Limiter:</strong> Dropped {displayHost.latestCheckinDebug.rateLimitedDroppedCount} rows that arrived too early.
                            </div>
                          )}
                        </div>
                      )}

                      {displayHost.recentQueries?.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {displayHost.recentQueries.map((query, idx) => (
                            <div key={idx} className="query-log-item">
                              <div>
                                <div className="query-log-name">{query.queryName}</div>
                                <div className="query-log-time">
                                  Received: {formatTime(query.timestamp.toString())}
                                </div>
                                {query.queryName === "user_activity" && (
                                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                                    Input Status: {displayHost.latestResults?.["user_activity"]?.find(r => r.name === "ActiveStatus")?.data || "Active"}
                                    {displayHost.latestResults?.["user_activity"]?.find(r => r.name === "IdleSeconds")?.data ? ` | Idle Time: ${displayHost.latestResults?.["user_activity"]?.find(r => r.name === "IdleSeconds")?.data}s` : ""}
                                  </div>
                                )}
                              </div>
                              <span className="query-log-badge">+{query.rowCount} rows</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="selection-pane-empty" style={{ padding: "40px" }}>
                          <span className="empty-icon">📋</span>
                          No check-in log history found.
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 5: Keyboard & Mouse Activity */}
                  {activeTab === "activity" && (
                    <div>
                      <div className="detail-section-label">Keyboard & Mouse Activity Tracker</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>

                        {/* Status Card */}
                        <div className="detail-panel" style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", justifyContent: "center", padding: "30px", textAlign: "center" }}>
                          {(() => {
                            const activity = displayHost.latestResults?.["user_activity"];
                            const status = activity?.find(r => r.name === "ActiveStatus")?.data || "Active";
                            const isActive = status === "Active";

                            return (
                              <>
                                <div style={{
                                  position: "relative",
                                  width: "70px",
                                  height: "70px",
                                  background: isActive ? "rgba(173, 255, 65, 0.1)" : "rgba(255, 179, 64, 0.1)",
                                  borderRadius: "50%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  border: isActive ? "1px solid var(--status-active)" : "1px solid var(--status-idle)"
                                }}>
                                  <span style={{
                                    fontSize: "2rem",
                                    color: isActive ? "var(--status-active)" : "var(--status-idle)"
                                  }}>
                                    {isActive ? "⌨️" : "💤"}
                                  </span>
                                  {isActive && <span className="live-dot" style={{ position: "absolute", right: "2px", top: "2px", width: "12px", height: "12px" }} />}
                                </div>
                                <div style={{ marginTop: "10px" }}>
                                  <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: isActive ? "var(--status-active)" : "var(--status-idle)" }}>
                                    User is {status}
                                  </h3>
                                  <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                    {isActive ? "Detecting continuous input keystrokes or mouse drift." : "No input interaction detected recently."}
                                  </p>
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        {/* Telemetry Metrics */}
                        <div className="detail-panel" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px" }}>
                          {(() => {
                            const activity = displayHost.latestResults?.["user_activity"];
                            const status = activity?.find(r => r.name === "ActiveStatus")?.data || "Active";
                            const idleSecs = activity?.find(r => r.name === "IdleSeconds")?.data || "0";
                            const lastInput = activity?.find(r => r.name === "LastInputTime")?.data;

                            return (
                              <>
                                <div className="sidebar-info-row" style={{ paddingBottom: "10px", borderBottom: "1px solid var(--border-medium)" }}>
                                  <span className="sidebar-label">Current Status</span>
                                  <span className="sidebar-value" style={{ fontWeight: "bold", color: status === "Active" ? "var(--status-active)" : "var(--status-idle)" }}>
                                    {status.toUpperCase()}
                                  </span>
                                </div>
                                <div className="sidebar-info-row" style={{ paddingBottom: "10px", borderBottom: "1px solid var(--border-medium)" }}>
                                  <span className="sidebar-label">Idle Inactivity Duration</span>
                                  <span className="sidebar-value" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                                    {idleSecs} seconds
                                  </span>
                                </div>
                                <div className="sidebar-info-row">
                                  <span className="sidebar-label">Last Activity Detected</span>
                                  <span className="sidebar-value" style={{ fontSize: "0.82rem", color: "var(--text-primary)" }}>
                                    {lastInput ? formatTime(lastInput) : "N/A"}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>

                      </div>

                      {/* Info message */}
                      <div style={{ marginTop: "16px", padding: "12px", background: "var(--bg-input)", borderRadius: "var(--radius-md)", fontSize: "0.76rem", color: "var(--text-secondary)", display: "flex", gap: "8px", alignItems: "center" }}>
                        <span>💡</span>
                        <span>This monitor tracks hardware inputs using the low-level Win32 <code>GetLastInputInfo</code> API to calculate exact user presence. It does not record keystroke characters (protecting privacy).</span>
                      </div>
                    </div>
                  )}

                  {/* TAB 6: Work Timeline (9AM–6PM status history) */}
                  {activeTab === "timeline" && (() => {
                    const history = displayHost.statusHistory || [];
                    const targetDateStr = new Date(selectedDate + "T00:00:00").toDateString();
                    const isTodaySelected = selectedDate === todayStr;

                    const workStart = 9 * 60;  // 9:00 AM in minutes
                    const workEnd = 18 * 60; // 6:00 PM in minutes
                    const totalWork = workEnd - workStart; // 540 min

                    const toMinutes = (iso: string) => {
                      const d = new Date(iso);
                      return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
                    };

                    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

                    const statusColor = (s: string) =>
                      s === "Active" ? "var(--status-active)" : s === "Idle" ? "var(--status-idle)" : "var(--status-offline)";

                    const statusBg = (s: string) =>
                      s === "Active" ? "var(--status-active-bg)" : s === "Idle" ? "var(--status-idle-bg)" : "var(--status-offline-bg)";

                    const formatDur = (secs?: number) => {
                      if (!secs) return "ongoing";
                      if (secs < 60) return `${secs}s`;
                      if (secs < 3600) return `${Math.round(secs / 60)}m`;
                      return `${(secs / 3600).toFixed(1)}h`;
                    };

                    const historyToday = history.filter(t => {
                      try { return new Date(t.startTime).toDateString() === targetDateStr; } catch { return false; }
                    });

                    // Event counts today
                    const idleEventCount = historyToday.filter(t => t.status === "Idle").length;
                    const offlineEventCount = historyToday.filter(t => t.status === "Offline").length;

                    // Work summary stats
                    const totalActiveSecs = historyToday
                      .filter(t => t.status === "Active")
                      .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
                    const totalIdleSecs = historyToday
                      .filter(t => t.status === "Idle")
                      .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
                    const totalOfflineSecs = historyToday
                      .filter(t => t.status === "Offline")
                      .reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);

                    return (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <div className="detail-section-label" style={{ margin: 0 }}>{selectedDate === todayStr ? "Today" : selectedDate} Work Timeline — 9:00 AM to 6:00 PM</div>
                          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                            Idle count: <span style={{ color: "var(--status-idle)" }}>{idleEventCount}</span>
                            {"  |  "}
                            Offline count: <span style={{ color: "var(--status-offline)" }}>{offlineEventCount}</span>
                          </div>
                        </div>

                        {/* Summary stats row */}
                        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
                          {[
                            { label: "Active", secs: totalActiveSecs, color: "var(--status-active)", bg: "var(--status-active-bg)", icon: "✅" },
                            { label: "Idle", secs: totalIdleSecs, color: "var(--status-idle)", bg: "var(--status-idle-bg)", icon: "💤" },
                            { label: "Offline", secs: totalOfflineSecs, color: "var(--status-offline)", bg: "var(--status-offline-bg)", icon: "⭕" },
                          ].map(item => (
                            <div key={item.label} style={{
                              flex: 1, minWidth: "120px", padding: "12px 16px",
                              background: item.bg, borderRadius: "var(--radius-md)",
                              border: `1px solid ${item.color}22`
                            }}>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>{item.icon} {item.label}</div>
                              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: item.color, fontFamily: "var(--font-mono)" }}>{formatDur(item.secs)}</div>
                              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "2px" }}>{Math.round(item.secs / 60)} min total</div>
                            </div>
                          ))}
                        </div>

                        {/* Horizontal bar timeline 9AM–6PM */}
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                            {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => (
                              <span key={h}>{h < 12 ? `${h}AM` : h === 12 ? "12PM" : `${h - 12}PM`}</span>
                            ))}
                          </div>
                          <div style={{ position: "relative", height: "36px", background: "var(--bg-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                            {historyToday.length === 0 ? (
                              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>No data recorded yet for {selectedDate === todayStr ? "today" : selectedDate}</div>
                            ) : (
                              historyToday.map((seg, i) => {
                                const startMin = clamp(toMinutes(seg.startTime), workStart, workEnd);
                                const endMin = seg.endTime ? clamp(toMinutes(seg.endTime), workStart, workEnd) : (isTodaySelected ? clamp(toMinutes(new Date().toISOString()), workStart, workEnd) : workEnd);
                                if (endMin <= startMin) return null;
                                const left = ((startMin - workStart) / totalWork) * 100;
                                const width = ((endMin - startMin) / totalWork) * 100;
                                return (
                                  <div
                                    key={i}
                                    title={`${seg.status}: ${new Date(seg.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} → ${seg.endTime ? new Date(seg.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"} (${formatDur(seg.durationSeconds)})`}
                                    style={{
                                      position: "absolute",
                                      left: `${left}%`,
                                      width: `${width}%`,
                                      top: 0, bottom: 0,
                                      background: statusColor(seg.status),
                                      opacity: 0.85,
                                      borderRight: "1px solid var(--bg-card)",
                                    }}
                                  />
                                );
                              })
                            )}
                          </div>
                          {/* Hour grid lines overlay */}
                          <div style={{ position: "relative", height: "6px" }}>
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                              <div key={i} style={{ position: "absolute", left: `${(i / 9) * 100}%`, top: 0, bottom: 0, width: "1px", background: "var(--border-subtle)" }} />
                            ))}
                          </div>
                        </div>

                        {/* Transition event list */}
                        <div className="detail-section-label" style={{ marginTop: "16px" }}>Idle & Offline Events {selectedDate === todayStr ? "Today" : selectedDate}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
                          {historyToday.filter(t => t.status !== "Active").length === 0 ? (
                            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>✅ No idle or offline events recorded {selectedDate === todayStr ? "today" : selectedDate}.</div>
                          ) : (
                            historyToday.filter(t => t.status !== "Active").map((t, i) => (
                              <div key={i} style={{
                                display: "flex", alignItems: "center", gap: "12px",
                                padding: "10px 14px",
                                background: statusBg(t.status),
                                borderRadius: "var(--radius-sm)",
                                border: `1px solid ${statusColor(t.status)}22`,
                              }}>
                                <span style={{ fontSize: "1.1rem" }}>{t.status === "Idle" ? "💤" : "⭕"}</span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, fontSize: "0.82rem", color: statusColor(t.status) }}>{t.status}</div>
                                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "2px", fontFamily: "var(--font-mono)" }}>
                                    {new Date(t.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    {" → "}
                                    {t.endTime ? new Date(t.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "ongoing"}
                                  </div>
                                </div>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 700, color: statusColor(t.status) }}>{formatDur(t.durationSeconds)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })()}

                </div>

              </div>
            </motion.div>
          </div>
        )}
        {showCreateAdminModal && (
          <div className="modal-overlay" onClick={() => setShowCreateAdminModal(false)}>
            <motion.div
              className="modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "500px" }}
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>Create Admin Account</h2>
                <button className="modal-close" onClick={() => setShowCreateAdminModal(false)}>×</button>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const res = await fetch("/api/admin/users", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: newAdminEmail,
                    password: newAdminPassword,
                    assignedMachines: newAdminAssigned
                  })
                });
                if (res.ok) {
                  setNewAdminEmail("");
                  setNewAdminPassword("");
                  setNewAdminAssigned([]);
                  setShowCreateAdminModal(false);
                  fetchAdmins();
                } else {
                  const data = await res.json();
                  alert(data.error || "Failed to create admin");
                }
              }} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Email Address</label>
                  <input
                    type="email"
                    className="console-select"
                    style={{ padding: "10px", width: "100%" }}
                    placeholder="e.g. admin@susalabs.in"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Password</label>
                  <input
                    type="password"
                    className="console-select"
                    style={{ padding: "10px", width: "100%" }}
                    placeholder="Minimum 8 characters"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Assign Machines</label>
                  <div style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border-medium)", padding: "10px", borderRadius: "var(--radius-sm)", background: "var(--bg-input)", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {hosts.map(h => (
                      <label key={h.nodeKey} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.8rem" }}>
                        <input
                          type="checkbox"
                          checked={newAdminAssigned.includes(h.nodeKey)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewAdminAssigned([...newAdminAssigned, h.nodeKey]);
                            } else {
                              setNewAdminAssigned(newAdminAssigned.filter(k => k !== h.nodeKey));
                            }
                          }}
                        />
                        {h.employeeName || h.hostname} ({h.platform})
                      </label>
                    ))}
                  </div>
                </div>
                <button type="submit" className="console-btn" style={{ width: "100%", marginTop: "10px" }}>
                  Create Administrator
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {editingAdmin && (
          <div className="modal-overlay" onClick={() => setEditingAdmin(null)}>
            <motion.div
              className="modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "500px" }}
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>Edit Assigned Machines</h2>
                <button className="modal-close" onClick={() => setEditingAdmin(null)}>×</button>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const res = await fetch(`/api/admin/users/${editingAdmin._id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    assignedMachines: editingAdmin.assignedMachines
                  })
                });
                if (res.ok) {
                  setEditingAdmin(null);
                  fetchAdmins();
                } else {
                  const data = await res.json();
                  alert(data.error || "Failed to update admin");
                }
              }} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Admin Email</label>
                  <div style={{ fontSize: "0.9rem", color: "var(--accent-text)", fontWeight: 600 }}>{editingAdmin.email}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Assign Machines</label>
                  <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border-medium)", padding: "10px", borderRadius: "var(--radius-sm)", background: "var(--bg-input)", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {hosts.map(h => (
                      <label key={h.nodeKey} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.8rem" }}>
                        <input
                          type="checkbox"
                          checked={editingAdmin.assignedMachines?.includes(h.nodeKey)}
                          onChange={(e) => {
                            const current = editingAdmin.assignedMachines || [];
                            if (e.target.checked) {
                              setEditingAdmin({
                                ...editingAdmin,
                                assignedMachines: [...current, h.nodeKey]
                              });
                            } else {
                              setEditingAdmin({
                                ...editingAdmin,
                                assignedMachines: current.filter((k: string) => k !== h.nodeKey)
                              });
                            }
                          }}
                        />
                        {h.employeeName || h.hostname} ({h.platform})
                      </label>
                    ))}
                  </div>
                </div>
                <button type="submit" className="console-btn" style={{ width: "100%", marginTop: "10px" }}>
                  Save Machine Assignments
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
