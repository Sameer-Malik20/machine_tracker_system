import { NextRequest, NextResponse } from "next/server";
import { comparePassword, signToken, seedSuperAdmin } from "@/lib/auth";
import User from "@/lib/models/User";
import connectDB from "@/lib/db";
import { serialize } from "cookie";

export const dynamic = "force-dynamic";

// In-memory rate limiting map for failed login attempts (keyed by client IP)
const loginLimiter = new Map<string, { count: number; resetTime: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginLimiter.get(ip);
  if (!record) return false;

  if (now > record.resetTime) {
    loginLimiter.delete(ip);
    return false;
  }

  return record.count >= 5;
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = loginLimiter.get(ip);
  if (!record) {
    loginLimiter.set(ip, { count: 1, resetTime: now + 15 * 60 * 1000 }); // 15 mins block duration
  } else {
    record.count += 1;
    if (record.count >= 5) {
      record.resetTime = now + 15 * 60 * 1000;
    }
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown-ip";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many failed login attempts. Please try again after 15 minutes." },
      { status: 429 }
    );
  }

  try {
    await seedSuperAdmin(); // Seed if not seeded yet
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    await connectDB();
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      recordFailedAttempt(ip);
      // Generic error message to prevent account enumeration/credential disclosure
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Clear rate limit record on successful login
    loginLimiter.delete(ip);

    // Sign jwt token
    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    // Set cookie headers. We serialize two cookies: the secure Host cookie and a fallback for http testing.
    const isLocalDev = process.env.NODE_ENV === "development";
    
    // Cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    };

    const response = NextResponse.json({
      success: true,
      user: {
        email: user.email,
        role: user.role,
      },
    });

    // Try setting __Host-wfh-session
    response.headers.append(
      "Set-Cookie",
      serialize("__Host-wfh-session", token, cookieOptions)
    );

    // Also set fallback token cookie for standard local dev HTTP
    response.headers.append(
      "Set-Cookie",
      serialize("wfh-session", token, {
        ...cookieOptions,
        secure: !isLocalDev, // Secure only if not local dev
      })
    );

    return response;
  } catch (error) {
    console.error("[API - Login Error] Internal failure:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
