import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import db from "@/src/lib/db";
import { config } from "@/src/lib/config";
import {
  createForwardAuthSession,
  createExchangeCode,
  checkHostAccessByDomain
} from "@/src/lib/models/forward-auth";
import { logAuditEvent } from "@/src/lib/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";

/**
 * Forward auth login endpoint — validates credentials and starts the exchange flow.
 * Called by the portal login form.
 */
export async function POST(request: NextRequest) {
  try {
    // CSRF: verify the request originates from the CPM portal
    const origin = request.headers.get("origin");
    const baseOrigin = new URL(config.baseUrl).origin;
    if (!origin || origin !== baseOrigin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    if (!redirectUri) {
      return NextResponse.json({ error: "Redirect URI is required" }, { status: 400 });
    }

    // Validate redirect URI — only allow http/https schemes
    let targetUrl: URL;
    try {
      targetUrl = new URL(redirectUri);
    } catch {
      return NextResponse.json({ error: "Invalid redirect URI" }, { status: 400 });
    }
    if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
      return NextResponse.json({ error: "Invalid redirect URI scheme" }, { status: 400 });
    }

    // Rate limiting — prefer x-real-ip (set by reverse proxy) over x-forwarded-for
    const ip =
      request.headers.get("x-real-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
      "unknown";
    const rateLimitResult = isRateLimited(ip);
    if (rateLimitResult.blocked) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Authenticate using the same logic as the credentials provider
    const email = `${username}@localhost`;
    const user = await db.query.users.findFirst({
      where: (table, operators) => operators.eq(table.email, email)
    });

    if (!user || user.status !== "active" || !user.passwordHash) {
      registerFailedAttempt(ip);
      logAuditEvent({
        userId: null,
        action: "forward_auth_login_failed",
        entityType: "user",
        summary: `Forward auth login failed for username: ${username}`
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      registerFailedAttempt(ip);
      logAuditEvent({
        userId: user.id,
        action: "forward_auth_login_failed",
        entityType: "user",
        entityId: user.id,
        summary: `Forward auth login failed for user ${user.email}`
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Successful credential check — reset rate limiter for this IP
    resetAttempts(ip);

    // Check if user has access to the target host
    const { hasAccess } = await checkHostAccessByDomain(user.id, targetUrl.hostname);
    if (!hasAccess) {
      logAuditEvent({
        userId: user.id,
        action: "forward_auth_access_denied",
        entityType: "proxy_host",
        summary: `Forward auth access denied for user ${user.email} to host ${targetUrl.hostname}`
      });
      return NextResponse.json(
        { error: "You do not have access to this application." },
        { status: 403 }
      );
    }

    // Create session and exchange code
    const { session } = await createForwardAuthSession(user.id);
    const { rawCode } = await createExchangeCode(session.id, redirectUri);

    logAuditEvent({
      userId: user.id,
      action: "forward_auth_login",
      entityType: "user",
      entityId: user.id,
      summary: `Forward auth login for user ${user.email} to ${targetUrl.hostname}`
    });

    // Build callback URL on the target domain
    const callbackUrl = new URL("/.cpm-auth/callback", targetUrl.origin);
    callbackUrl.searchParams.set("code", rawCode);

    return NextResponse.json({ redirectTo: callbackUrl.toString() });
  } catch (error) {
    console.error("Forward auth login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
