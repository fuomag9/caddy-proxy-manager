import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/src/lib/auth";

/**
 * Next.js Proxy for route protection.
 * Provides defense-in-depth by checking authentication at the edge
 * before requests reach page components.
 *
 * Note: Proxy always runs on Node.js runtime.
 */

const isDev = process.env.NODE_ENV === "development";
const BASE_PATH = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

/**
 * Build a nonce-based Content-Security-Policy per request.
 * Next.js reads the nonce from the CSP request header and applies it
 * to all inline scripts it generates.
 */
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://cdn.jsdelivr.net`
      : `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    // style-src still needs 'unsafe-inline' for React JSX inline style props
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "worker-src blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export default async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Allow public routes
  if (
    pathname === `${BASE_PATH}/login` ||
    pathname === `${BASE_PATH}/portal` ||
    pathname.startsWith(`${BASE_PATH}/api/auth`) ||
    pathname === `${BASE_PATH}/api/health` ||
    pathname === `${BASE_PATH}/api/instances/sync` ||
    pathname.startsWith(`${BASE_PATH}/api/v1/`) ||
    pathname.startsWith(`${BASE_PATH}/api/forward-auth/`)
  ) {
    return NextResponse.next();
  }

  // Check authentication for protected routes
  const session = await auth(req);
  const isAuthenticated = !!session?.user;

  // Redirect unauthenticated users to login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/login`, req.url));
  }

  // Generate per-request nonce for CSP
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = buildCsp(nonce);

  // Set CSP as a request header so Next.js can read the nonce
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Also set CSP as a response header for browser enforcement
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
