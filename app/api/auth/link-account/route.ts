import { NextRequest, NextResponse } from "next/server";
import { verifyLinkingToken, verifyAndLinkOAuth } from "@/src/lib/services/account-linking";
import { createAuditEvent } from "@/src/lib/models/audit";
import { registerFailedAttempt } from "@/src/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { linkingToken, password } = body;

    if (!linkingToken || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify linking token
    const tokenPayload = await verifyLinkingToken(linkingToken);
    if (!tokenPayload) {
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 }
      );
    }

    // Rate limiting: prevent brute force password attacks during OAuth linking
    const rateLimitKey = `oauth-link-verify:${tokenPayload.userId}`;
    const rateLimitResult = registerFailedAttempt(rateLimitKey);
    if (rateLimitResult.blocked) {
      // Audit log for blocked attempt
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
      // Audit log for failed password verification
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

    // Audit log
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
