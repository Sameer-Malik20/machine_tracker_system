import { NextResponse } from "next/server";
import { serialize } from "cookie";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  const clearCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(0),
  };

  // Clear both cookies by setting expiration to epoch
  response.headers.append(
    "Set-Cookie",
    serialize("__Host-wfh-session", "", clearCookieOptions)
  );
  response.headers.append(
    "Set-Cookie",
    serialize("wfh-session", "", {
      ...clearCookieOptions,
      secure: false,
    })
  );

  return response;
}
