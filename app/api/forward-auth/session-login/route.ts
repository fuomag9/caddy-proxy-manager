import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import {
  createForwardAuthSession,
  createExchangeCode,
  checkHostAccessByDomain,
  consumeRedirectIntent
} from "@/src/lib/models/forward-auth";
import { logAuditEvent } from "@/src/lib/audit";

/**
 * Forward auth session login — uses an existing NextAuth session to create
 * a forward auth session. Called automatically when the portal detects the
 * user is already logged in (e.g. after OAuth).
 */
export async function POST(request: NextRequest) {
  try {
    // CSRF: verify the request originates from the CPM portal
    const origin = request.headers.get("origin");
    const baseOrigin = new URL(config.baseUrl).origin;
    if (!origin || origin !== baseOrigin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const rid = typeof body.rid === "string" ? body.rid : "";

    if (!rid) {
      return NextResponse.json({ error: "Missing redirect intent" }, { status: 400 });
    }

    // Consume the redirect intent — returns the server-stored redirect URI
    const redirectUri = await consumeRedirectIntent(rid);
    if (!redirectUri) {
      return NextResponse.json({ error: "Invalid or expired redirect intent. Please try again." }, { status: 400 });
    }

    const targetUrl = new URL(redirectUri);
    const userId = Number(session.user.id);

    // Check if user has access to the target host
    const { hasAccess } = await checkHostAccessByDomain(userId, targetUrl.hostname);
    if (!hasAccess) {
      logAuditEvent({
        userId,
        action: "forward_auth_access_denied",
        entityType: "proxy_host",
        summary: `Forward auth access denied for user ${session.user.email} to host ${targetUrl.hostname}`
      });
      return NextResponse.json(
        { error: "You do not have access to this application." },
        { status: 403 }
      );
    }

    // Create forward auth session and exchange code
    const { session: faSession } = await createForwardAuthSession(userId);
    const { rawCode } = await createExchangeCode(faSession.id, redirectUri);

    logAuditEvent({
      userId,
      action: "forward_auth_login",
      entityType: "user",
      entityId: userId,
      summary: `Forward auth login (session) for user ${session.user.email} to ${targetUrl.hostname}`
    });

    const callbackUrl = new URL("/.cpm-auth/callback", targetUrl.origin);
    callbackUrl.searchParams.set("code", rawCode);

    return NextResponse.json({ redirectTo: callbackUrl.toString() });
  } catch (error) {
    console.error("Forward auth session login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
