import { NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin, getCurrentSessionInfo } from "@/src/lib/auth";
import { getUserById, updateUserPassword } from "@/src/lib/models/user";
import { revokeOtherUserSessions } from "@/src/lib/models/sessions";
import { deleteUserForwardAuthSessions } from "@/src/lib/models/forward-auth";
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

    // An account without a password (OAuth-only) has no current password to
    // prove, so adding one requires a recent sign-in instead: a stolen,
    // long-lived session must not be able to attach a durable credential.
    if (!user.passwordHash) {
      const signedInAt = currentSession?.createdAt.getTime() ?? NaN;
      if (!(Date.now() - signedInAt <= RECENT_SIGN_IN_MS)) {
        return NextResponse.json(
          { error: "Please sign in again before setting a password." },
          { status: 403 }
        );
      }
    }

    // If user has a password, verify current password
    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required" },
          { status: 400 }
        );
      }

      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
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

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await updateUserPassword(userId, newPasswordHash);

    // End every other sign-in: other management sessions and all forward-auth
    // sessions. The caller's current session stays so they are not logged out.
    await revokeOtherUserSessions(userId, currentSession?.id ?? null);
    await deleteUserForwardAuthSessions(userId);

    // Audit log
    await createAuditEvent({
      userId,
      action: user.passwordHash ? "password_changed" : "password_set",
      entityType: "user",
      entityId: userId,
      summary: user.passwordHash ? "User changed their password" : "User set a password",
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Password change error:", error);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
