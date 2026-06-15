import mongoose, { Schema, Document } from "mongoose";

export interface IEnrolledNode extends Document {
  nodeKey: string;
  hostname: string;
  platform: string;
  enrolledAt: Date;
  lastSeenAt: Date;
}

const EnrolledNodeSchema: Schema = new Schema(
  {
    nodeKey: { type: String, required: true, unique: true, index: true },
    hostname: { type: String, required: true },
    platform: { type: String, default: "unknown" },
    enrolledAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.models.EnrolledNode ||
  mongoose.model<IEnrolledNode>("EnrolledNode", EnrolledNodeSchema);
