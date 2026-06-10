import mongoose, { Schema, Document } from "mongoose";

export interface IPlatformSettings {
  processInterval: number;
  performanceInterval: number;
  networkInterval: number;
  activityInterval: number;
}

export interface IAdminSettings extends Document {
  logIntervalMinutes: number; // 1, 10, 30, 60
  dataRetentionDays: number; // e.g. 30 days
  retentionAction: "delete" | "archive"; // "delete" or "archive"
  windows: IPlatformSettings;
  mac: IPlatformSettings;
  updatedAt: Date;
}

const PlatformSettingsSchema = new Schema({
  processInterval: { type: Number, default: 60 },
  performanceInterval: { type: Number, default: 60 },
  networkInterval: { type: Number, default: 60 },
  activityInterval: { type: Number, default: 60 },
}, { _id: false });

const AdminSettingsSchema = new Schema(
  {
    logIntervalMinutes: { type: Number, default: 10 }, // Default to 10m
    dataRetentionDays: { type: Number, default: 30 }, // Default to 30 days
    retentionAction: { type: String, enum: ["delete", "archive"], default: "archive" }, // Default to archive
    windows: { type: PlatformSettingsSchema, default: () => ({}) },
    mac: { type: PlatformSettingsSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export default mongoose.models.AdminSettings || mongoose.model<IAdminSettings>("AdminSettings", AdminSettingsSchema);
