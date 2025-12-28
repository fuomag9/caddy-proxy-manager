import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import db from "@/src/lib/db";
import { users } from "@/src/lib/db/schema";
import { eq } from "drizzle-orm";
import { nowIso } from "@/src/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const user = await getUserById(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Must have a password before unlinking OAuth
    if (!user.password_hash) {
      return NextResponse.json(
        { error: "Cannot unlink OAuth: You must set a password first" },
        { status: 400 }
      );
    }

    // Must be using OAuth to unlink
    if (user.provider === "credentials") {
      return NextResponse.json(
        { error: "No OAuth account to unlink" },
        { status: 400 }
      );
    }

    const previousProvider = user.provider;

    // Revert to credentials-only
    const email = user.email;
    const username = email.replace(/@localhost$/, "") || email.split("@")[0];

    await db
      .update(users)
      .set({
        provider: "credentials",
        subject: `${username}@localhost`,
        updatedAt: nowIso()
      })
      .where(eq(users.id, userId));

    // Audit log
    await createAuditEvent({
      userId,
      action: "oauth_unlinked",
      entityType: "user",
      entityId: userId,
      summary: `User unlinked OAuth account: ${previousProvider}`,
      data: JSON.stringify({ provider: previousProvider })
    });

    return NextResponse.json({
      success: true,
      message: "OAuth account unlinked successfully"
    });
  } catch (error) {
    console.error("OAuth unlink error:", error);
    return NextResponse.json(
      { error: "Failed to unlink OAuth account" },
      { status: 500 }
    );
  }
}
