import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";
import { buildCsp } from "@/src/lib/csp";

/**
 * Next.js Proxy for route protection.
 * Provides defense-in-depth by checking authentication at the edge
 * before requests reach page components.
 *
 * Note: Proxy always runs on Node.js runtime.
 */

/**
 * Continue the request with the nonce-based CSP. The policy is also set as a
 * request header, which is where the root layout reads the nonce from; this
 * overwrites any Content-Security-Policy header the client sent.
 */
function withSecurityHeaders(req: NextRequest): NextResponse {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  return response;
}

export default async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Allow public routes. They get the same security headers as authenticated
  // pages as defense in depth. After a credential login the login page loads
  // the dashboard as a new document, which gets its own policy and nonce.
  if (
    pathname === "/login" ||
    pathname === "/portal" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/instances/sync" ||
    pathname.startsWith("/api/v1/") ||
    pathname.startsWith("/api/forward-auth/")
  ) {
    return withSecurityHeaders(req);
  }

  // Check authentication for protected routes
  const session = await auth(req);
  const isAuthenticated = !!session?.user;

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !pathname.startsWith("/login")) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return withSecurityHeaders(req);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - maplibre (maplibre-gl's tile worker bundle, staged into public/ at
     *   build time; it must load as a module script even if the session has
     *   expired, otherwise the redirect to /login is parsed as JS and the
     *   analytics map silently breaks)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|maplibre/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
