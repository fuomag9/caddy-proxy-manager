import { and, eq } from "drizzle-orm";
import db from "../db";
import { sessions } from "../db/schema";

/**
 * Active management-UI session for a user, as shown in the profile's
 * "Active sessions" view. (Forward-auth `_cpm_fa` sessions are tracked
 * separately and are not management-UI sessions.)
 */
export interface UserSession {
  id: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** List a user's non-expired sessions, newest first. */
export async function listUserSessions(userId: number): Promise<UserSession[]> {
  const now = Date.now();
  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return rows
    .filter((r) => {
      const exp = new Date(r.expiresAt).getTime();
      return Number.isNaN(exp) || exp > now;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Revoke a single session, but only if it belongs to the given user.
 * Returns false if no such session exists for that user (so callers can 404).
 */
export async function revokeUserSession(userId: number, sessionId: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!existing) return false;
  await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return true;
}

/**
 * Revoke all of a user's sessions except `exceptSessionId` (typically the
 * caller's current session). Returns the number of sessions revoked.
 */
export async function revokeOtherUserSessions(
  userId: number,
  exceptSessionId: number | null
): Promise<number> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  const toRevoke = rows.map((r) => r.id).filter((id) => id !== exceptSessionId);
  for (const id of toRevoke) {
    await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
  }
  return toRevoke.length;
}
