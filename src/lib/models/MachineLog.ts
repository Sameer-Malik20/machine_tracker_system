import mongoose, { Schema, Document } from "mongoose";

export interface IMachineLog extends Document {
  nodeKey: string;
  name: string; // Query name (e.g. running_processes, user_activity, etc)
  action: "added" | "removed" | "snapshot";
  columns: Record<string, string>;
  timestamp: Date; // Log date
  archived: boolean;
  archivedAt?: Date;
  createdAt: Date;
}

const MachineLogSchema: Schema = new Schema(
  {
    nodeKey: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    action: { type: String, required: true },
    columns: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, required: true, index: true },
    archived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Compound index for quick retrievals
MachineLogSchema.index({ nodeKey: 1, timestamp: -1 });

export default mongoose.models.MachineLog || mongoose.model<IMachineLog>("MachineLog", MachineLogSchema);
