import { NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";
import db from "@/src/lib/db";
import { accounts } from "@/src/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

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
    if (!user.passwordHash) {
      return NextResponse.json(
        { error: "Cannot unlink OAuth: You must set a password first" },
        { status: 400 }
      );
    }

    // Check if user has any OAuth account links
    const oauthAccounts = await db.select().from(accounts).where(
      and(
        eq(accounts.userId, userId),
        ne(accounts.providerId, "credential")
      )
    );

    if (oauthAccounts.length === 0) {
      return NextResponse.json(
        { error: "No OAuth account to unlink" },
        { status: 400 }
      );
    }

    const previousProvider = oauthAccounts[0].providerId;

    // Delete the OAuth account link(s)
    await db.delete(accounts).where(
      and(
        eq(accounts.userId, userId),
        ne(accounts.providerId, "credential")
      )
    );

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
