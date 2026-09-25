import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import db from "@/src/lib/db";
import { config } from "@/src/lib/config";
import {
  createForwardAuthSession,
  createExchangeCode,
  checkHostAccess,
  consumeRedirectIntent,
  isRedirectIntentUsable
} from "@/src/lib/models/forward-auth";
import { logAuditEvent } from "@/src/lib/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";

// Compared against when the account does not exist, so unknown and known
// usernames take the same time to reject.
let dummyHash: string | null = null;
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync("cpm-forward-auth-dummy-password", 12);
  return dummyHash;
}

/**
 * Client IP for rate limiting: the address appended by the nearest proxy
 * (rightmost X-Forwarded-For entry). X-Real-IP is not used because Caddy
 * neither sets nor strips it, so it is always client-controlled.
 */
function clientIpKey(request: NextRequest): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return `ip:${ip || "unknown"}`;
}

/**
 * Forward auth login endpoint — validates credentials and starts the exchange flow.
 * Called by the portal login form with an opaque redirect intent ID (rid).
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
    const rid = typeof body.rid === "string" ? body.rid : "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    if (!rid) {
      return NextResponse.json({ error: "Missing redirect intent" }, { status: 400 });
    }

    // Reject an unusable intent before touching the credentials, so this
    // response never depends on whether the password was right.
    if (!(await isRedirectIntentUsable(rid))) {
      return NextResponse.json({ error: "Invalid or expired redirect intent. Please try again." }, { status: 400 });
    }

    // Rate limit per client IP and per account; either one blocks.
    const ipKey = clientIpKey(request);
    const accountKey = `account:${username.toLowerCase()}`;
    if (isRateLimited(ipKey).blocked || isRateLimited(accountKey).blocked) {
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

    const passwordHash = user && user.status === "active" ? user.passwordHash : null;
    const isValid = await bcrypt.compare(password, passwordHash ?? getDummyHash());
    if (!user || !passwordHash || !isValid) {
      registerFailedAttempt(ipKey);
      registerFailedAttempt(accountKey);
      logAuditEvent({
        userId: user?.id ?? null,
        action: "forward_auth_login_failed",
        entityType: "user",
        ...(user ? { entityId: user.id } : {}),
        summary: `Forward auth login failed for username: ${username.slice(0, 64)}`
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Consume the redirect intent — returns the server-stored redirect URI.
    // This is a one-time operation: the intent is deleted after consumption.
    const intent = await consumeRedirectIntent(rid);
    if (!intent) {
      return NextResponse.json({ error: "Invalid or expired redirect intent. Please try again." }, { status: 400 });
    }

    // Successful credential check for a live intent — reset both limiters.
    resetAttempts(ipKey);
    resetAttempts(accountKey);

    const targetUrl = new URL(intent.redirectUri);

    // Check access against the exact proxy-host audience captured by the intent.
    // Re-resolving only by hostname here would allow a changed wildcard mapping
    // to silently change the authorization target mid-flow.
    const hasAccess = await checkHostAccess(user.id, intent.audience.proxyHostId);
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
    const { session } = await createForwardAuthSession(user.id, intent.audience);
    const { rawCode } = await createExchangeCode(
      session.id,
      intent.redirectUri,
      intent.audience,
    );

    logAuditEvent({
      userId: user.id,
      action: "forward_auth_login",
      entityType: "user",
      entityId: user.id,
      summary: `Forward auth login for user ${user.email} to ${targetUrl.hostname}`
    });

    // Build callback URL on the target domain
    const callbackUrl = new URL("/.cpm-auth/callback", intent.audience.origin);
    callbackUrl.searchParams.set("code", rawCode);

    return NextResponse.json({ redirectTo: callbackUrl.toString() });
  } catch (error) {
    console.error("Forward auth login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
