import { auth } from "@/src/lib/auth";
import { NextResponse } from "next/server";

/**
 * Next.js Proxy for route protection.
 * Provides defense-in-depth by checking authentication at the edge
 * before requests reach page components.
 *
 * Note: Proxy always runs on Node.js runtime.
 */

export default auth((req) => {
  const isAuthenticated = !!req.auth;
  const pathname = req.nextUrl.pathname;

  // Allow public routes
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/geoip-status" ||
    pathname === "/api/instances/sync"
  ) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !pathname.startsWith("/login")) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

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
