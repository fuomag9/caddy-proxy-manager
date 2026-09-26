import { NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin, getCurrentSessionInfo } from "@/src/lib/auth";
import { changeUserPassword, getUserById, getUserPasswordHash } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import bcrypt from "bcryptjs";
import { passwordPolicyMessage } from "@/src/lib/password-policy";

// How recent a sign-in must be to add a first password to an account.
const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit password change attempts to prevent brute-forcing current password
    const rateLimitKey = `password-change:${session.user.id}`;
    const rateCheck = isRateLimited(rateLimitKey);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: rateCheck.retryAfterMs ? { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } : undefined }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Enforce password complexity matching production admin password requirements
    const policyError =
      typeof newPassword === "string" ? passwordPolicyMessage(newPassword, "New password") : "New password is required";
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentSession = await getCurrentSessionInfo(request);
    const currentHash = await getUserPasswordHash(user);

    // An account without a password (OAuth-only) has no current password to
    // prove, so adding one requires a recent sign-in instead: a stolen,
    // long-lived session must not be able to attach a durable credential.
    if (!currentHash) {
      const signedInAt = currentSession?.createdAt.getTime() ?? NaN;
      if (!(Date.now() - signedInAt <= RECENT_SIGN_IN_MS)) {
        return NextResponse.json(
          { error: "Please sign in again before setting a password." },
          { status: 403 }
        );
      }
    } else {
      if (typeof currentPassword !== "string" || !currentPassword) {
        return NextResponse.json(
          { error: "Current password is required" },
          { status: 400 }
        );
      }

      const isValid = await bcrypt.compare(currentPassword, currentHash);
      if (!isValid) {
        registerFailedAttempt(rateLimitKey);
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 401 }
        );
      }
    }

    // Password verified successfully — reset rate limit counter
    resetAttempts(rateLimitKey);

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Set the password and end every other sign-in (other management sessions
    // and all forward-auth sessions) in one transaction. The caller's current
    // session stays so they are not logged out; when it cannot be identified,
    // every session ends.
    await changeUserPassword(userId, newPasswordHash, currentSession?.id ?? null);

    // The password has changed at this point, so a failure to audit it is
    // logged rather than reported to the user as a failed change.
    try {
      await createAuditEvent({
        userId,
        action: currentHash ? "password_changed" : "password_set",
        entityType: "user",
        entityId: userId,
        summary: currentHash ? "User changed their password" : "User set a password",
      });
    } catch (error) {
      console.error("Failed to audit password change:", error);
    }

    return NextResponse.json({
      success: true,
      message:
        "Password updated. Your other sessions have been signed out. API tokens are not affected; revoke them under API Tokens if needed.",
    });
  } catch (error) {
    console.error("Password change error:", error);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
