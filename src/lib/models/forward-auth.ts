import { createHash, randomBytes } from "node:crypto";
import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import {
  forwardAuthSessions,
  forwardAuthExchanges,
  forwardAuthAccess,
  forwardAuthRedirectIntents,
  groupMembers,
} from "../db/schema";
import { and, eq, gt, inArray, lt } from "drizzle-orm";

const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const EXCHANGE_CODE_TTL = 60; // 60 seconds
const REDIRECT_INTENT_TTL = 10 * 60; // 10 minutes — covers login + OAuth flow time

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Redirect Intents ────────────────────────────────────────────────
// Store redirect URIs server-side so the client only holds an opaque ID.

export async function createRedirectIntent(redirectUri: string): Promise<string> {
  // Validate redirect URI to prevent open redirects
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error("Invalid redirect URI");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Redirect URI must use http or https scheme");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Redirect URI must not contain credentials");
  }

  const rid = randomBytes(16).toString("hex");
  const ridHash = hashToken(rid);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + REDIRECT_INTENT_TTL * 1000).toISOString();

  await db.insert(forwardAuthRedirectIntents).values({
    ridHash,
    redirectUri,
    expiresAt,
    consumed: false,
    createdAt: now
  });

  // Opportunistic cleanup of expired intents
  await db
    .delete(forwardAuthRedirectIntents)
    .where(lt(forwardAuthRedirectIntents.expiresAt, now));

  return rid;
}

export async function consumeRedirectIntent(
  rid: string
): Promise<string | null> {
  const ridHash = hashToken(rid);
  const now = nowIso();

  // Atomic claim: only succeeds if the intent exists, is unconsumed, and not expired
  const claimed = await db
    .update(forwardAuthRedirectIntents)
    .set({ consumed: true })
    .where(
      and(
        eq(forwardAuthRedirectIntents.ridHash, ridHash),
        eq(forwardAuthRedirectIntents.consumed, false),
        gt(forwardAuthRedirectIntents.expiresAt, now)
      )
    )
    .returning();

  if (claimed.length === 0) return null;

  const redirectUri = claimed[0].redirectUri;

  // Delete immediately after consumption
  await db
    .delete(forwardAuthRedirectIntents)
    .where(eq(forwardAuthRedirectIntents.id, claimed[0].id));

  return redirectUri;
}

// ── Sessions ─────────────────────────────────────────────────────────

export type ForwardAuthSession = {
  id: number;
  userId: number;
  expiresAt: string;
  createdAt: string;
};

export async function createForwardAuthSession(
  userId: number,
  ttlSeconds?: number
): Promise<{ rawToken: string; session: ForwardAuthSession }> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const now = nowIso();
  const ttl = ttlSeconds ?? DEFAULT_SESSION_TTL;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const [row] = await db
    .insert(forwardAuthSessions)
    .values({ userId, tokenHash, expiresAt, createdAt: now })
    .returning();

  if (!row) throw new Error("Failed to create forward auth session");

  return {
    rawToken,
    session: {
      id: row.id,
      userId: row.userId,
      expiresAt: toIso(row.expiresAt)!,
      createdAt: toIso(row.createdAt)!
    }
  };
}

export async function validateForwardAuthSession(
  rawToken: string
): Promise<{ sessionId: number; userId: number } | null> {
  const tokenHash = hashToken(rawToken);
  const session = await db.query.forwardAuthSessions.findFirst({
    where: (table, operators) => operators.eq(table.tokenHash, tokenHash)
  });

  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;

  return { sessionId: session.id, userId: session.userId };
}

export async function listForwardAuthSessions(): Promise<ForwardAuthSession[]> {
  const rows = await db.query.forwardAuthSessions.findMany({
    where: (table, operators) => operators.gt(table.expiresAt, nowIso())
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    expiresAt: toIso(r.expiresAt)!,
    createdAt: toIso(r.createdAt)!
  }));
}

export async function deleteForwardAuthSession(id: number): Promise<void> {
  await db.delete(forwardAuthSessions).where(eq(forwardAuthSessions.id, id));
}

export async function deleteUserForwardAuthSessions(userId: number): Promise<void> {
  await db
    .delete(forwardAuthSessions)
    .where(eq(forwardAuthSessions.userId, userId));
}

// ── Exchange Codes ───────────────────────────────────────────────────

export async function createExchangeCode(
  sessionId: number,
  redirectUri: string
): Promise<{ rawCode: string }> {
  const rawCode = randomBytes(32).toString("hex");
  const codeHash = hashToken(rawCode);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + EXCHANGE_CODE_TTL * 1000).toISOString();

  await db.insert(forwardAuthExchanges).values({
    sessionId,
    codeHash,
    sessionToken: "[pending]", // placeholder — fresh token generated at redemption
    redirectUri,
    expiresAt,
    used: false,
    createdAt: now
  });

  return { rawCode };
}

export async function redeemExchangeCode(
  rawCode: string
): Promise<{ sessionId: number; redirectUri: string; rawSessionToken: string } | null> {
  const codeHash = hashToken(rawCode);
  const now = nowIso();

  // Atomic claim: only succeeds if the exchange exists, is unused, and not expired
  const claimed = await db
    .update(forwardAuthExchanges)
    .set({ used: true })
    .where(
      and(
        eq(forwardAuthExchanges.codeHash, codeHash),
        eq(forwardAuthExchanges.used, false),
        gt(forwardAuthExchanges.expiresAt, now)
      )
    )
    .returning();

  if (claimed.length === 0) return null;
  const exchange = claimed[0];

  // Generate a fresh session token (never stored in the exchange table)
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await db
    .update(forwardAuthSessions)
    .set({ tokenHash })
    .where(eq(forwardAuthSessions.id, exchange.sessionId));

  // Delete the redeemed exchange immediately
  await db
    .delete(forwardAuthExchanges)
    .where(eq(forwardAuthExchanges.id, exchange.id));

  return {
    sessionId: exchange.sessionId,
    redirectUri: exchange.redirectUri,
    rawSessionToken: rawToken
  };
}

// ── Host Access Control ──────────────────────────────────────────────

export type ForwardAuthAccessEntry = {
  id: number;
  proxyHostId: number;
  userId: number | null;
  groupId: number | null;
  createdAt: string;
};

export async function checkHostAccess(
  userId: number,
  proxyHostId: number
): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: (table, operators) => operators.eq(table.id, userId)
  });
  if (!user) return false;

  // Check direct user access
  const directAccess = await db.query.forwardAuthAccess.findFirst({
    where: (table, operators) =>
      operators.and(
        operators.eq(table.proxyHostId, proxyHostId),
        operators.eq(table.userId, userId)
      )
  });
  if (directAccess) return true;

  // Check group-based access
  const userGroupIds = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));

  if (userGroupIds.length === 0) return false;

  const groupIds = userGroupIds.map((r) => r.groupId);
  const groupAccess = await db.query.forwardAuthAccess.findFirst({
    where: (table, operators) =>
      operators.and(
        operators.eq(table.proxyHostId, proxyHostId),
        inArray(table.groupId, groupIds)
      )
  });

  return !!groupAccess;
}

export async function checkHostAccessByDomain(
  userId: number,
  host: string
): Promise<{ hasAccess: boolean; proxyHostId: number | null }> {
  // Find proxy host(s) that contain this domain
  const allHosts = await db.query.proxyHosts.findMany({
    where: (table, operators) => operators.eq(table.enabled, true)
  });

  for (const ph of allHosts) {
    let parsed: string[];
    try {
      parsed = JSON.parse(ph.domains);
    } catch {
      continue;
    }
    if (parsed.some((d) => d.toLowerCase() === host.toLowerCase())) {
      const hasAccess = await checkHostAccess(userId, ph.id);
      return { hasAccess, proxyHostId: ph.id };
    }
  }

  // Host not found in any proxy host — deny by default
  return { hasAccess: false, proxyHostId: null };
}

export async function getForwardAuthAccessForHost(
  proxyHostId: number
): Promise<ForwardAuthAccessEntry[]> {
  const rows = await db
    .select()
    .from(forwardAuthAccess)
    .where(eq(forwardAuthAccess.proxyHostId, proxyHostId));

  return rows.map((r) => ({
    id: r.id,
    proxyHostId: r.proxyHostId,
    userId: r.userId,
    groupId: r.groupId,
    createdAt: toIso(r.createdAt)!
  }));
}

export async function setForwardAuthAccess(
  proxyHostId: number,
  access: { userIds?: number[]; groupIds?: number[] },
  actorUserId: number
): Promise<ForwardAuthAccessEntry[]> {
  // Delete existing access for this host
  await db
    .delete(forwardAuthAccess)
    .where(eq(forwardAuthAccess.proxyHostId, proxyHostId));

  const now = nowIso();
  const values: Array<{
    proxyHostId: number;
    userId: number | null;
    groupId: number | null;
    createdAt: string;
  }> = [];

  for (const uid of access.userIds ?? []) {
    values.push({ proxyHostId, userId: uid, groupId: null, createdAt: now });
  }
  for (const gid of access.groupIds ?? []) {
    values.push({ proxyHostId, userId: null, groupId: gid, createdAt: now });
  }

  if (values.length > 0) {
    await db.insert(forwardAuthAccess).values(values);
  }

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "forward_auth_access",
    entityId: proxyHostId,
    summary: `Updated forward auth access for proxy host ${proxyHostId}`
  });

  return getForwardAuthAccessForHost(proxyHostId);
}

// ── Domain Validation ────────────────────────────────────────────────

export async function isForwardAuthDomain(host: string): Promise<boolean> {
  const allHosts = await db.query.proxyHosts.findMany({
    where: (table, operators) => operators.eq(table.enabled, true)
  });

  for (const ph of allHosts) {
    let parsed: string[];
    try {
      parsed = JSON.parse(ph.domains);
    } catch {
      continue;
    }
    if (parsed.some((d) => d.toLowerCase() === host.toLowerCase())) {
      // Check that this host actually has forward auth enabled
      let parsedMeta: Record<string, unknown>;
      try {
        parsedMeta = ph.meta ? JSON.parse(ph.meta) : {};
      } catch {
        continue;
      }
      const fa = parsedMeta.cpm_forward_auth as Record<string, unknown> | undefined;
      if (fa?.enabled) return true;
    }
  }
  return false;
}

// ── Cleanup ──────────────────────────────────────────────────────────

export async function cleanupExpiredSessions(): Promise<number> {
  const now = nowIso();

  // Delete expired exchanges first (FK constraint)
  await db
    .delete(forwardAuthExchanges)
    .where(lt(forwardAuthExchanges.expiresAt, now));

  // Delete expired sessions
  const result = await db
    .delete(forwardAuthSessions)
    .where(lt(forwardAuthSessions.expiresAt, now))
    .returning();

  return result.length;
}
