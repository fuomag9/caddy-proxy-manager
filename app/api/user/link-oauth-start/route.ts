import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import db, { nowIso } from "@/src/lib/db";
import { pendingOAuthLinks } from "@/src/lib/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { registerFailedAttempt } from "@/src/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);

    // Rate limiting: prevent OAuth linking spam
    const rateLimitKey = `oauth-link:${userId}`;
    const rateLimitResult = registerFailedAttempt(rateLimitKey);
    if (rateLimitResult.blocked) {
      return NextResponse.json(
        { error: "Too many OAuth linking attempts. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { provider } = body;

    if (!provider) {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    const userEmail = session.user.email;

    if (!userEmail) {
      return NextResponse.json({ error: "User email not found" }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now

    // Clean up old expired entries for all users
    await db.delete(pendingOAuthLinks).where(lt(pendingOAuthLinks.expiresAt, nowIso()));

    // Delete any existing pending link for THIS USER and this provider
    // (unique index will prevent duplicates, but we delete explicitly for clarity)
    await db.delete(pendingOAuthLinks).where(
      and(
        eq(pendingOAuthLinks.userId, userId),
        eq(pendingOAuthLinks.provider, provider)
      )
    );

    // Insert new pending link record for THIS USER only
    await db.insert(pendingOAuthLinks).values({
      userId,
      provider,
      userEmail,
      createdAt: nowIso(),
      expiresAt: expiresAt.toISOString()
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("OAuth linking start error:", error);
    return NextResponse.json(
      { error: "Failed to start OAuth linking" },
      { status: 500 }
    );
  }
}
