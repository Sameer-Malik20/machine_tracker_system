import fs from "fs";
import path from "path";

export interface PlatformSettings {
  processInterval: number; // in seconds
  performanceInterval: number; // in seconds
  networkInterval: number; // in seconds
  activityInterval: number; // in seconds
}

export interface Settings {
  windows: PlatformSettings;
  mac: PlatformSettings;
}

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

const DEFAULT_SETTINGS: Settings = {
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

  public static getSettings(): Settings {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        this.cachedSettings = JSON.parse(data);
        return this.cachedSettings!;
      }
    } catch (e) {
      console.error("Error reading settings.json, using defaults", e);
    }

    this.cachedSettings = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }

  public static saveSettings(settings: Settings): void {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
      this.cachedSettings = settings;
    } catch (e) {
      console.error("Failed to save settings.json", e);
    }
  }

  public static getIntervalsForPlatform(platform: string): PlatformSettings {
    const settings = this.getSettings();
    // Normalize platform name
    const platformLower = platform.toLowerCase();
    const isMac = platformLower === "darwin" || platformLower === "mac" || platformLower === "macos";
    return isMac ? settings.mac : settings.windows;
  }
}
export default SettingsManager;
