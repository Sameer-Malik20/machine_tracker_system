import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "./models/User";
import connectDB from "./db";

export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  
  const secretFile = "./jwt_secret.txt";
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, "utf-8").trim();
  }
  
  console.warn("Generating ephemeral secret. Instance-isolated!");
  const randomSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretFile, randomSecret, "utf-8");
  } catch (err) {
    console.error("Failed to persist ephemeral secret to file:", err);
  }
  return randomSecret;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface UserPayload {
  userId: string;
  email: string;
  role: "super_admin" | "admin";
}

export function signToken(payload: UserPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "7d" });
}

export function verifyToken(token: string): UserPayload | null {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as any;
    if (decoded && decoded.userId && decoded.email && decoded.role) {
      return {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
    }
    return null;
  } catch (err) {
    console.error("[Auth] Token verification failed:", err);
    return null;
  }
}

/**
 * Idempotently seeds the super admin user if not present.
 */
export async function seedSuperAdmin() {
  try {
    await connectDB();
    const adminEmail = (process.env.SUPER_ADMIN_EMAIL || "sameer@susalabs.in").toLowerCase();
    const existing = await User.findOne({ email: adminEmail });
    if (!existing) {
      console.log(`[Auth - Seed] Pre-seeding super admin user: ${adminEmail}`);
      const rawPassword = process.env.SUPER_ADMIN_PASSWORD || "Sameer@123";
      const passwordHash = await hashPassword(rawPassword);
      await User.create({
        email: adminEmail,
        passwordHash,
        role: "super_admin",
        assignedMachines: [],
      });
      console.log("[Auth - Seed] Super admin pre-seeded successfully");
    }
  } catch (err) {
    console.error("[Auth - Seed Error] Failed to seed super admin:", err);
  }
}
