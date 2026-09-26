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
import { hostMatchesPattern } from "../host-pattern-priority";
import { config } from "../config";

const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const EXCHANGE_CODE_TTL = 60; // 60 seconds
const REDIRECT_INTENT_TTL = 10 * 60; // 10 minutes — covers login + OAuth flow time

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type ForwardAuthAudience = {
  /** Exact normalized external origin: scheme + hostname + non-default port. */
  origin: string;
  /** Hostname without a port, used only for display/audit messages. */
  hostname: string;
  /** The concrete proxy-host record which authorized the wildcard/exact host. */
  proxyHostId: number;
};

/** Parse an http(s) URL without credentials, whatever its port. */
function parseForwardAuthUrlAnyPort(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Caddy routes by hostname only, so a non-default port is accepted only when
 * the operator declared it as an external forward-auth port.
 */
function isForwardAuthPortAllowed(parsed: URL): boolean {
  return !parsed.port || config.forwardAuthAllowedPorts.has(parsed.port);
}

function parseForwardAuthUrl(rawUrl: string): URL | null {
  const parsed = parseForwardAuthUrlAnyPort(rawUrl);
  return parsed && isForwardAuthPortAllowed(parsed) ? parsed : null;
}

// Ports reported in the current window, so each one is logged once per window.
// The cap bounds the log volume when clients probe many ports of a protected
// hostname; the window restarts hourly, so ports crowded out by such probing
// are still reported later.
let reportedDisallowedPorts = new Set<string>();
let reportWindowStartedAt = 0;
const MAX_REPORTED_DISALLOWED_PORTS = 32;
const DISALLOWED_PORT_REPORT_WINDOW_MS = 60 * 60 * 1000;

function reportDisallowedPort(hostname: string, port: string): void {
  const now = Date.now();
  if (now < reportWindowStartedAt || now - reportWindowStartedAt >= DISALLOWED_PORT_REPORT_WINDOW_MS) {
    reportedDisallowedPorts = new Set();
    reportWindowStartedAt = now;
  }
  if (
    reportedDisallowedPorts.has(port) ||
    reportedDisallowedPorts.size >= MAX_REPORTED_DISALLOWED_PORTS
  ) {
    return;
  }
  reportedDisallowedPorts.add(port);
  console.warn(
    `[forward-auth] Rejected ${hostname}:${port} because port ${port} is not listed in ` +
      `FORWARD_AUTH_ALLOWED_PORTS. If forward-auth protected sites are served on port ${port}, ` +
      `add it to FORWARD_AUTH_ALLOWED_PORTS (comma-separated) and recreate the web container (docker compose up -d).`
  );
}

function audienceMatchesUrl(audience: ForwardAuthAudience, parsed: URL): boolean {
  return (
    Number.isInteger(audience.proxyHostId) &&
    audience.proxyHostId > 0 &&
    audience.origin === parsed.origin &&
    audience.hostname === parsed.hostname.toLowerCase()
  );
}

// ── Redirect Intents ────────────────────────────────────────────────
// Store redirect URIs server-side so the client only holds an opaque ID.

export async function createRedirectIntent(redirectUri: string): Promise<string> {
  // Resolve and persist the concrete target now.  In particular, a wildcard
  // match is reduced to the exact origin the browser will visit and the one
  // proxy-host record that authorized it.
  const audience = await resolveForwardAuthAudience(redirectUri);
  if (!audience) throw new Error("Redirect URI is not a forward-auth target");

  const rid = randomBytes(16).toString("hex");
  const ridHash = hashToken(rid);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + REDIRECT_INTENT_TTL * 1000).toISOString();

  await db.insert(forwardAuthRedirectIntents).values({
    ridHash,
    proxyHostId: audience.proxyHostId,
    audienceOrigin: audience.origin,
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

/**
 * Whether a redirect intent exists, is unconsumed and unexpired — without
 * claiming it.  Lets the login endpoint reject a bad intent before it spends
 * any effort on (or reveals anything about) the submitted credentials.
 */
export async function isRedirectIntentUsable(rid: string): Promise<boolean> {
  if (!rid) return false;
  const intent = await db.query.forwardAuthRedirectIntents.findFirst({
    where: (table, operators) =>
      operators.and(
        operators.eq(table.ridHash, hashToken(rid)),
        operators.eq(table.consumed, false),
        operators.gt(table.expiresAt, nowIso())
      ),
  });
  return !!intent;
}

export async function consumeRedirectIntent(
  rid: string
): Promise<{
  redirectUri: string;
  audience: ForwardAuthAudience;
} | null> {
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

  const intent = claimed[0];

  // Delete immediately after consumption
  await db
    .delete(forwardAuthRedirectIntents)
    .where(eq(forwardAuthRedirectIntents.id, intent.id));

  const parsed = parseForwardAuthUrl(intent.redirectUri);
  if (!parsed || !intent.audienceOrigin || !intent.proxyHostId) return null;

  const audience: ForwardAuthAudience = {
    origin: intent.audienceOrigin,
    hostname: parsed.hostname.toLowerCase(),
    proxyHostId: intent.proxyHostId,
  };
  if (!audienceMatchesUrl(audience, parsed)) return null;

  // Fail closed if the proxy-host mapping changed between creation and use.
  const currentAudience = await resolveForwardAuthAudience(intent.redirectUri);
  if (
    !currentAudience ||
    currentAudience.origin !== audience.origin ||
    currentAudience.proxyHostId !== audience.proxyHostId
  ) {
    return null;
  }

  return { redirectUri: intent.redirectUri, audience };
}

// ── Sessions ─────────────────────────────────────────────────────────

export type ForwardAuthSession = {
  id: number;
  userId: number;
  proxyHostId: number;
  audienceOrigin: string;
  expiresAt: string;
  createdAt: string;
};

export async function createForwardAuthSession(
  userId: number,
  audience: ForwardAuthAudience,
  ttlSeconds?: number
): Promise<{ rawToken: string; session: ForwardAuthSession }> {
  const parsedAudience = parseForwardAuthUrl(audience.origin);
  if (!parsedAudience || !audienceMatchesUrl(audience, parsedAudience)) {
    throw new Error("Invalid forward-auth audience");
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const now = nowIso();
  const ttl = ttlSeconds ?? DEFAULT_SESSION_TTL;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const [row] = await db
    .insert(forwardAuthSessions)
    .values({
      userId,
      proxyHostId: audience.proxyHostId,
      audienceOrigin: audience.origin,
      tokenHash,
      expiresAt,
      createdAt: now,
    })
    .returning();

  if (!row) throw new Error("Failed to create forward auth session");

  return {
    rawToken,
    session: {
      id: row.id,
      userId: row.userId,
      proxyHostId: row.proxyHostId,
      audienceOrigin: row.audienceOrigin,
      expiresAt: toIso(row.expiresAt)!,
      createdAt: toIso(row.createdAt)!
    }
  };
}

export async function validateForwardAuthSession(
  rawToken: string,
  audience: ForwardAuthAudience,
): Promise<{ sessionId: number; userId: number } | null> {
  const tokenHash = hashToken(rawToken);
  const session = await db.query.forwardAuthSessions.findFirst({
    where: (table, operators) => operators.eq(table.tokenHash, tokenHash)
  });

  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;
  if (
    session.proxyHostId !== audience.proxyHostId ||
    session.audienceOrigin !== audience.origin
  ) {
    return null;
  }

  return { sessionId: session.id, userId: session.userId };
}

export async function listForwardAuthSessions(): Promise<ForwardAuthSession[]> {
  const rows = await db.query.forwardAuthSessions.findMany({
    where: (table, operators) => operators.gt(table.expiresAt, nowIso())
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    proxyHostId: r.proxyHostId,
    audienceOrigin: r.audienceOrigin,
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
  redirectUri: string,
  audience: ForwardAuthAudience,
): Promise<{ rawCode: string }> {
  const parsedRedirect = parseForwardAuthUrl(redirectUri);
  if (!parsedRedirect || !audienceMatchesUrl(audience, parsedRedirect)) {
    throw new Error("Invalid forward-auth audience");
  }

  const session = await db.query.forwardAuthSessions.findFirst({
    where: (table, operators) => operators.eq(table.id, sessionId)
  });
  if (
    !session ||
    session.proxyHostId !== audience.proxyHostId ||
    session.audienceOrigin !== audience.origin
  ) {
    throw new Error("Forward-auth session audience mismatch");
  }

  const rawCode = randomBytes(32).toString("hex");
  const codeHash = hashToken(rawCode);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + EXCHANGE_CODE_TTL * 1000).toISOString();

  await db.insert(forwardAuthExchanges).values({
    sessionId,
    proxyHostId: audience.proxyHostId,
    audienceOrigin: audience.origin,
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
  rawCode: string,
  audience: ForwardAuthAudience,
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
        eq(forwardAuthExchanges.proxyHostId, audience.proxyHostId),
        eq(forwardAuthExchanges.audienceOrigin, audience.origin),
        eq(forwardAuthExchanges.used, false),
        gt(forwardAuthExchanges.expiresAt, now)
      )
    )
    .returning();

  if (claimed.length === 0) return null;
  const exchange = claimed[0];

  const parsedRedirect = parseForwardAuthUrl(exchange.redirectUri);
  if (!parsedRedirect || !audienceMatchesUrl(audience, parsedRedirect)) {
    await db
      .delete(forwardAuthExchanges)
      .where(eq(forwardAuthExchanges.id, exchange.id));
    return null;
  }

  // Generate a fresh session token (never stored in the exchange table)
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const updatedSessions = await db
    .update(forwardAuthSessions)
    .set({ tokenHash })
    .where(
      and(
        eq(forwardAuthSessions.id, exchange.sessionId),
        eq(forwardAuthSessions.proxyHostId, audience.proxyHostId),
        eq(forwardAuthSessions.audienceOrigin, audience.origin),
        gt(forwardAuthSessions.expiresAt, now),
      )
    )
    .returning({ id: forwardAuthSessions.id });

  // Delete the redeemed exchange immediately
  await db
    .delete(forwardAuthExchanges)
    .where(eq(forwardAuthExchanges.id, exchange.id));

  if (updatedSessions.length === 0) return null;

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

  // Exact-match hosts take precedence over wildcard-covered ones, mirroring
  // how Caddy itself prioritizes routes (see host-pattern-priority.ts).
  let wildcardMatch: (typeof allHosts)[number] | null = null;
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
    if (!wildcardMatch && parsed.some((d) => hostMatchesPattern(host, d))) {
      wildcardMatch = ph;
    }
  }

  if (wildcardMatch) {
    const hasAccess = await checkHostAccess(userId, wildcardMatch.id);
    return { hasAccess, proxyHostId: wildcardMatch.id };
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

function hasForwardAuthEnabled(ph: { meta: string | null }): boolean {
  let parsedMeta: Record<string, unknown>;
  try {
    parsedMeta = ph.meta ? JSON.parse(ph.meta) : {};
  } catch {
    return false;
  }
  const fa = parsedMeta.cpm_forward_auth as Record<string, unknown> | undefined;
  return !!fa?.enabled;
}

async function findForwardAuthProxyHost(host: string) {
  const allHosts = await db.query.proxyHosts.findMany({
    where: (table, operators) => operators.eq(table.enabled, true)
  });

  // Exact-match hosts take precedence over wildcard-covered ones: if an
  // explicit host exists for this domain, its own forward-auth setting
  // decides the outcome and the wildcard host is never consulted — this
  // mirrors the routing precedence Caddy itself applies.
  let exactMatchFound = false;
  let wildcardMatch: (typeof allHosts)[number] | null = null;

  for (const ph of allHosts) {
    let parsed: string[];
    try {
      parsed = JSON.parse(ph.domains);
    } catch {
      continue;
    }
    if (parsed.some((d) => d.toLowerCase() === host.toLowerCase())) {
      exactMatchFound = true;
      if (hasForwardAuthEnabled(ph)) return ph;
      continue;
    }
    if (!wildcardMatch && parsed.some((d) => hostMatchesPattern(host, d))) {
      wildcardMatch = ph;
    }
  }

  if (!exactMatchFound && wildcardMatch) {
    return hasForwardAuthEnabled(wildcardMatch) ? wildcardMatch : null;
  }

  return null;
}

/**
 * Resolve a URL to one exact forward-auth audience.  Wildcard proxy hosts are
 * supported, but the resulting audience always contains the concrete origin
 * visited by the browser, never the wildcard pattern itself.
 */
export async function resolveForwardAuthAudience(
  targetUrl: string,
): Promise<ForwardAuthAudience | null> {
  const parsed = parseForwardAuthUrlAnyPort(targetUrl);
  if (!parsed) return null;

  const proxyHost = await findForwardAuthProxyHost(parsed.hostname);
  if (!proxyHost) return null;

  if (!isForwardAuthPortAllowed(parsed)) {
    reportDisallowedPort(parsed.hostname, parsed.port);
    return null;
  }

  return {
    origin: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
    proxyHostId: proxyHost.id,
  };
}

export async function isForwardAuthDomain(host: string): Promise<boolean> {
  return !!(await findForwardAuthProxyHost(host));
}

/**
 * The explicit port of `targetUrl` when that URL names a forward-auth host and
 * the port is not listed in FORWARD_AUTH_ALLOWED_PORTS, otherwise null.  Such
 * a URL can never be signed in to; the portal uses this to say why.
 */
export async function getDisallowedForwardAuthPort(targetUrl: string): Promise<string | null> {
  const parsed = parseForwardAuthUrlAnyPort(targetUrl);
  if (!parsed || isForwardAuthPortAllowed(parsed)) return null;
  if (!(await findForwardAuthProxyHost(parsed.hostname))) return null;
  reportDisallowedPort(parsed.hostname, parsed.port);
  return parsed.port;
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
