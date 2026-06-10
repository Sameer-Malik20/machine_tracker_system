import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: "super_admin" | "admin";
  assignedMachines: string[]; // List of nodeKeys or hostnames this admin can view
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["super_admin", "admin"], default: "admin" },
    assignedMachines: [{ type: String }], // Assigned machines node_keys/hostnames
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
