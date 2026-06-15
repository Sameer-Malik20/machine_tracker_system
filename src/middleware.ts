import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Define public paths that bypass auth checks
  const isPublicPath =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/osquery/enroll") ||
    pathname.startsWith("/api/osquery/config") ||
    pathname.startsWith("/api/osquery/log") ||
    pathname.startsWith("/api/osquery/interval") ||
    pathname.startsWith("/_next/") ||
    pathname.includes("favicon.ico") ||
    pathname.includes("logo.jpeg");

  // Retrieve token from Host-prefixed session cookie, with fallback for local non-https/localhost dev envs
  const token =
    request.cookies.get("__Host-wfh-session")?.value ||
    request.cookies.get("wfh-session")?.value;

  if (!isPublicPath && !token) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized. Session cookie required." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  // Enforce HTTP security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Content Security Policy permitting dev builds & local web socket connections
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:;"
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.jpeg).*)"],
};
