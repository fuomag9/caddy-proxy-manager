import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import {
  createForwardAuthSession,
  createExchangeCode,
  checkHostAccessByDomain
} from "@/src/lib/models/forward-auth";
import { logAuditEvent } from "@/src/lib/audit";

/**
 * Forward auth session login — creates a forward auth session from an existing
 * NextAuth session (used after OAuth login redirects back to the portal).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";

    if (!redirectUri) {
      return NextResponse.json({ error: "Redirect URI is required" }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(redirectUri);
    } catch {
      return NextResponse.json({ error: "Invalid redirect URI" }, { status: 400 });
    }

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
    const { rawToken, session: faSession } = await createForwardAuthSession(userId);
    const { rawCode } = await createExchangeCode(faSession.id, rawToken, redirectUri);

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
