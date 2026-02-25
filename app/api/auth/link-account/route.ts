import { NextRequest, NextResponse } from "next/server";
import { retrieveLinkingToken, verifyLinkingToken, verifyAndLinkOAuth } from "@/src/lib/services/account-linking";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { linkingId, password } = body;

    if (!linkingId || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Retrieve and consume the linking token server-side — the raw JWT never reaches the browser
    const rawToken = await retrieveLinkingToken(linkingId);
    if (!rawToken) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 }
      );
    }

    const tokenPayload = await verifyLinkingToken(rawToken);
    if (!tokenPayload) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 }
      );
    }

    // Rate limiting: check before attempting password verification
    const rateLimitKey = `oauth-link-verify:${tokenPayload.userId}`;
    const rateLimitCheck = isRateLimited(rateLimitKey);
    if (rateLimitCheck.blocked) {
      await createAuditEvent({
        userId: tokenPayload.userId,
        action: "oauth_link_rate_limited",
        entityType: "user",
        entityId: tokenPayload.userId,
        summary: `OAuth linking rate limited: too many password attempts`,
        data: JSON.stringify({ provider: tokenPayload.provider })
      });

      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Verify password and link OAuth account
    const success = await verifyAndLinkOAuth(
      tokenPayload.userId,
      password,
      tokenPayload.provider,
      tokenPayload.providerAccountId
    );

    if (!success) {
      // Count this failure against the rate limit
      registerFailedAttempt(rateLimitKey);

      await createAuditEvent({
        userId: tokenPayload.userId,
        action: "oauth_link_password_failed",
        entityType: "user",
        entityId: tokenPayload.userId,
        summary: `Failed password verification during OAuth linking`,
        data: JSON.stringify({ provider: tokenPayload.provider })
      });

      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 }
      );
    }

    // Success — clear rate limit for this user
    resetAttempts(rateLimitKey);

    await createAuditEvent({
      userId: tokenPayload.userId,
      action: "account_linked",
      entityType: "user",
      entityId: tokenPayload.userId,
      summary: `OAuth account manually linked: ${tokenPayload.provider}`,
      data: JSON.stringify({
        provider: tokenPayload.provider,
        email: tokenPayload.email
      })
    });

    return NextResponse.json({
      success: true,
      message: "Account linked successfully"
    });
  } catch (error) {
    console.error("Account linking error:", error);
    return NextResponse.json(
      { error: "Failed to link account" },
      { status: 500 }
    );
  }
}
