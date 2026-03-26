import { NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { getUserById, updateUserPassword } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";
import bcrypt from "bcryptjs";

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
    if (!newPassword || newPassword.length < 12) {
      return NextResponse.json(
        { error: "New password must be at least 12 characters long" },
        { status: 400 }
      );
    }
    const complexityErrors: string[] = [];
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword)) {
      complexityErrors.push("must include both uppercase and lowercase letters");
    }
    if (!/[0-9]/.test(newPassword)) {
      complexityErrors.push("must include at least one number");
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      complexityErrors.push("must include at least one special character");
    }
    if (complexityErrors.length > 0) {
      return NextResponse.json(
        { error: `Password ${complexityErrors.join(", ")}` },
        { status: 400 }
      );
    }

    const userId = Number(session.user.id);
    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If user has a password, verify current password
    if (user.password_hash) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required" },
          { status: 400 }
        );
      }

      const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
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
    const newPasswordHash = bcrypt.hashSync(newPassword, 12);

    // Update password
    await updateUserPassword(userId, newPasswordHash);

    // Audit log
    await createAuditEvent({
      userId,
      action: user.password_hash ? "password_changed" : "password_set",
      entityType: "user",
      entityId: userId,
      summary: user.password_hash ? "User changed their password" : "User set a password",
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
