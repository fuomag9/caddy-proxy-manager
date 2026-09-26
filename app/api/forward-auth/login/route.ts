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
import { getClientIp } from "@/src/lib/client-ip";
import { getUserPasswordHash } from "@/src/lib/models/user";
import { beginPortalLoginAttempt } from "@/src/lib/forward-auth-login-limiter";

// Compared against when the account does not exist, is inactive or has no
// password, so those cases take as long to reject as a wrong password. A cost-12
// hash (the cost used for real accounts) of a discarded random 64-character
// string, precomputed so no request pays for generating it.
const DUMMY_PASSWORD_HASH = "$2b$12$PzXbwkFBGk6JwDDBJVq5wulZ85qKnoUuxbl8638n85GUpYyLE61Aa";

// The form posts a username, a password and a rid; anything larger is not a login.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_USERNAME_LENGTH = 256;

/** Reads the request body as text, or returns null once it exceeds MAX_BODY_BYTES. */
async function readBodyText(request: NextRequest): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Looks up the account and checks the password, using the same logic as the
 * credentials provider. Runs exactly one bcrypt compare whether or not the
 * account can sign in, so every rejection takes about as long.
 */
async function checkCredentials(username: string, password: string) {
  const email = `${username}@localhost`;
  const user = await db.query.users.findFirst({
    where: (table, operators) => operators.eq(table.email, email)
  });
  const passwordHash = user && user.status === "active" ? await getUserPasswordHash(user) : null;
  const isValid = await bcrypt.compare(password, passwordHash ?? DUMMY_PASSWORD_HASH);
  return { user, valid: Boolean(passwordHash) && isValid };
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

    const text = await readBodyText(request);
    if (text === null) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rid = typeof body.rid === "string" ? body.rid : "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    if (username.length > MAX_USERNAME_LENGTH) {
      return NextResponse.json({ error: "Username is too long" }, { status: 400 });
    }
    if (!rid) {
      return NextResponse.json({ error: "Missing redirect intent" }, { status: 400 });
    }

    // Reject an unusable intent before touching the credentials, so this
    // response never depends on whether the password was right.
    if (!(await isRedirectIntentUsable(rid))) {
      return NextResponse.json({ error: "Invalid or expired redirect intent. Please try again." }, { status: 400 });
    }

    // Rate limit per client, per (account, client) and per account (a higher
    // ceiling); any one blocks. The attempt holds its place in each limit
    // until its outcome is recorded, so concurrent requests cannot all slip
    // past the check.
    const attempt = beginPortalLoginAttempt(username, getClientIp(request.headers));
    if (!attempt) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    let credentials: Awaited<ReturnType<typeof checkCredentials>>;
    try {
      credentials = await checkCredentials(username, password);
    } catch (error) {
      attempt.release();
      throw error;
    }
    const { user, valid } = credentials;
    if (!user || !valid) {
      attempt.fail();
      logAuditEvent({
        userId: user?.id ?? null,
        action: "forward_auth_login_failed",
        entityType: "user",
        ...(user ? { entityId: user.id } : {}),
        summary: `Forward auth login failed for username: ${username.slice(0, 64)}`
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    attempt.succeed();

    // Consume the redirect intent — returns the server-stored redirect URI.
    // This is a one-time operation: the intent is deleted after consumption.
    const intent = await consumeRedirectIntent(rid);
    if (!intent) {
      return NextResponse.json({ error: "Invalid or expired redirect intent. Please try again." }, { status: 400 });
    }

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
