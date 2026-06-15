import fs from "fs";
import path from "path";
import { connectDB } from "./db";
import AdminSettings from "./models/AdminSettings";

export interface PlatformSettings {
  processInterval: number; // in seconds
  performanceInterval: number; // in seconds
  networkInterval: number; // in seconds
  activityInterval: number; // in seconds
}

export interface Settings {
  logIntervalMinutes: number; // 1 | 5 | 10 | 30 | 60
  dataRetentionDays: number; // e.g. 30
  retentionAction: "delete" | "archive"; // delete or archive
  windows: PlatformSettings;
  mac: PlatformSettings;
}

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

const DEFAULT_SETTINGS: Settings = {
  logIntervalMinutes: 30,
  dataRetentionDays: 30,
  retentionAction: "archive",
  windows: {
    processInterval: 60,
    performanceInterval: 60,
    networkInterval: 60,
    activityInterval: 60,
  },
  mac: {
    processInterval: 60,
    performanceInterval: 60,
    networkInterval: 60,
    activityInterval: 60,
  },
};

export class SettingsManager {
  private static cachedSettings: Settings | null = null;

  public static async getSettings(): Promise<Settings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    try {
      await connectDB();
      const settingsDoc = await AdminSettings.findOne();
      if (settingsDoc) {
        const settings: Settings = {
          logIntervalMinutes: settingsDoc.logIntervalMinutes ?? 10,
          dataRetentionDays: settingsDoc.dataRetentionDays ?? 30,
          retentionAction: settingsDoc.retentionAction ?? "archive",
          windows: {
            processInterval: settingsDoc.windows?.processInterval ?? 60,
            performanceInterval: settingsDoc.windows?.performanceInterval ?? 60,
            networkInterval: settingsDoc.windows?.networkInterval ?? 60,
            activityInterval: settingsDoc.windows?.activityInterval ?? 60,
          },
          mac: {
            processInterval: settingsDoc.mac?.processInterval ?? 60,
            performanceInterval: settingsDoc.mac?.performanceInterval ?? 60,
            networkInterval: settingsDoc.mac?.networkInterval ?? 60,
            activityInterval: settingsDoc.mac?.activityInterval ?? 60,
          },
        };
        this.cachedSettings = settings;
        return settings;
      }
    } catch (e) {
      console.error("Error reading settings from MongoDB, trying local JSON file", e);
    }

    // JSON file fallback
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        this.cachedSettings = JSON.parse(data);
        return this.cachedSettings!;
      }
    } catch (e) {
      console.error("Error reading settings.json fallback, using hardcoded defaults", e);
    }

    this.cachedSettings = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }

  public static async saveSettings(settings: Settings): Promise<void> {
    try {
      await connectDB();
      let settingsDoc = await AdminSettings.findOne();
      if (!settingsDoc) {
        await AdminSettings.create(settings);
      } else {
        settingsDoc.logIntervalMinutes = settings.logIntervalMinutes;
        settingsDoc.dataRetentionDays = settings.dataRetentionDays;
        settingsDoc.retentionAction = settings.retentionAction;
        settingsDoc.windows = settings.windows;
        settingsDoc.mac = settings.mac;
        await settingsDoc.save();
      }
      this.cachedSettings = settings;
    } catch (e) {
      console.error("Failed to save settings to MongoDB, saving locally only", e);
    }

    // Write file fallback so local tools still have access
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to write settings.json fallback", e);
    }
  }

  public static async getIntervalsForPlatform(platform: string): Promise<PlatformSettings> {
    const settings = await this.getSettings();
    // Normalize platform name
    const platformLower = platform.toLowerCase();
    const isMac = platformLower === "darwin" || platformLower === "mac" || platformLower === "macos";
    return isMac ? settings.mac : settings.windows;
  }
}
export default SettingsManager;
