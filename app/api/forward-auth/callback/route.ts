import { NextRequest, NextResponse } from "next/server";
import { redeemExchangeCode } from "@/src/lib/models/forward-auth";
import { resolveTrustedForwardAuthAudience } from "@/src/lib/forward-auth-trust";

const COOKIE_NAME = "_cpm_fa";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

/**
 * Forward auth callback — redeems an exchange code and sets the session cookie.
 * Caddy routes /.cpm-auth/callback on proxied domains to this endpoint.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return new NextResponse("Missing code parameter", { status: 400 });
  }

  // The public Next.js origin may be reachable directly, so forwarded headers
  // are accepted only with the proof injected by the generated Caddy route,
  // and only for the proxy host that route belongs to.
  const audience = await resolveTrustedForwardAuthAudience(request.headers);
  if (!audience) {
    return new NextResponse(
      "Invalid or expired authorization code. Please try logging in again.",
      { status: 401 }
    );
  }

  const result = await redeemExchangeCode(code, audience);
  if (!result) {
    return new NextResponse(
      "Invalid or expired authorization code. Please try logging in again.",
      { status: 401 }
    );
  }

  // Redirect back to original URL with the session cookie set
  const response = NextResponse.redirect(result.redirectUri, 302);

  response.cookies.set(COOKIE_NAME, result.rawSessionToken, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE
  });

  return response;
}
