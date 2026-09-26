/**
 * deleteUser applies the schema's onDelete rules itself: production SQLite
 * runs with foreign_keys off, so nothing cascades on its own, and a user
 * created later under the same id (the primary admin is always id 1) would
 * take over the deleted user's sessions, API tokens and sign-in methods.
 * ensureAdminUser clears what older releases' deleteUser left behind.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { count, eq, is, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { SQLiteTable, getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createTestDb, type TestDb } from '../helpers/db';
import * as schema from '../../src/lib/db/schema';

const ctx = vi.hoisted(() => ({
  db: null as unknown as TestDb,
}));

vi.mock('../../src/lib/db', () => ({
  get default() { return ctx.db; },
  get sqlite() { return undefined; },
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  },
}));
vi.mock('../../src/lib/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/config')>();
  return {
    ...original,
    config: { ...original.config, adminUsername: 'admin', adminPassword: 'Env-Password-2026!' },
  };
});

import { deleteUser, getUserById } from '../../src/lib/models/user';
import { createApiToken, validateToken } from '../../src/lib/models/api-tokens';
import { ensureAdminUser } from '../../src/lib/init-db';

beforeEach(() => {
  ctx.db = createTestDb();
  // better-sqlite3 turns foreign keys on; production (bun:sqlite) leaves them off.
  ctx.db.run(sql`PRAGMA foreign_keys = OFF`);
});

async function seedUser(email: string): Promise<number> {
  const now = new Date().toISOString();
  const [user] = await ctx.db.insert(schema.users).values({
    email, name: email, role: 'admin', provider: 'credentials', subject: email,
    status: 'active', createdAt: now, updatedAt: now,
  }).returning();
  return user.id;
}

/**
 * A row for `userId` in every table that references users.id, plus a
 * forward-auth exchange code for its forward-auth session and the state of an
 * OAuth "link account" flow it started. Returns the API token and the
 * forward-auth session id.
 */
async function seedReferences(userId: number): Promise<{ rawToken: string; forwardAuthSessionId: number }> {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const tag = `${userId}-${Math.random().toString(36).slice(2)}`;
  const db = ctx.db;

  await db.insert(schema.sessions).values({
    userId, token: `session-${tag}`, expiresAt: later, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    userId, issuer: 'https://idp.example.com', accountId: `subject-${tag}`, providerId: 'oidc',
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.pendingOAuthLinks).values({
    userId, provider: 'oidc', userEmail: `user-${tag}@example.com`, createdAt: now, expiresAt: later,
  });
  // Better Auth stores link.userId as a string or a number depending on the caller.
  for (const linkUserId of [String(userId), userId]) {
    await db.insert(schema.verifications).values({
      identifier: `state-${tag}-${typeof linkUserId}`,
      value: JSON.stringify({
        callbackURL: 'https://cpm.example.com/profile',
        codeVerifier: 'verifier',
        expiresAt: Date.now() + 600_000,
        link: { email: `user-${tag}@example.com`, userId: linkUserId },
      }),
      expiresAt: later, createdAt: now, updatedAt: now,
    });
  }
  const { rawToken } = await createApiToken('automation', userId);

  const [group] = await db.insert(schema.groups).values({
    name: `group-${tag}`, createdBy: userId, createdAt: now, updatedAt: now,
  }).returning();
  await db.insert(schema.groupMembers).values({ groupId: group.id, userId, createdAt: now });

  const [host] = await db.insert(schema.proxyHosts).values({
    name: `host-${tag}`, domains: '["app.example.com"]', upstreams: '["backend:8080"]',
    ownerUserId: userId, createdAt: now, updatedAt: now,
  }).returning();
  await db.insert(schema.forwardAuthAccess).values({ proxyHostId: host.id, userId, createdAt: now });
  const [forwardAuthSession] = await db.insert(schema.forwardAuthSessions).values({
    userId, proxyHostId: host.id, audienceOrigin: 'https://app.example.com',
    tokenHash: `fa-${tag}`, expiresAt: later, createdAt: now,
  }).returning();
  await db.insert(schema.forwardAuthExchanges).values({
    sessionId: forwardAuthSession.id, proxyHostId: host.id, audienceOrigin: 'https://app.example.com',
    codeHash: `code-${tag}`, sessionToken: 'placeholder', redirectUri: 'https://app.example.com/',
    expiresAt: later, createdAt: now,
  });

  await db.insert(schema.l4ProxyHosts).values({
    name: `l4-${tag}`, protocol: 'tcp', listenAddress: ':5432', upstreams: '["db:5432"]',
    ownerUserId: userId, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.accessLists).values({
    name: `list-${tag}`, createdBy: userId, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.certificates).values({
    name: `cert-${tag}`, type: 'managed', domainNames: '["app.example.com"]',
    createdBy: userId, createdAt: now, updatedAt: now,
  });
  const [ca] = await db.insert(schema.caCertificates).values({
    name: `ca-${tag}`, certificatePem: 'ca-pem', createdBy: userId, createdAt: now, updatedAt: now,
  }).returning();
  await db.insert(schema.issuedClientCertificates).values({
    caCertificateId: ca.id, commonName: `client-${tag}`, serialNumber: tag, fingerprintSha256: tag,
    certificatePem: 'client-pem', validFrom: now, validTo: later, createdBy: userId, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.mtlsRoles).values({
    name: `role-${tag}`, createdBy: userId, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.mtlsAccessRules).values({
    proxyHostId: host.id, pathPattern: '/admin/*', createdBy: userId, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.auditEvents).values({
    userId, action: 'create', entityType: 'proxy_host', entityId: host.id, summary: 'Created host', createdAt: now,
  });

  return { rawToken, forwardAuthSessionId: forwardAuthSession.id };
}

async function countWhere(table: SQLiteTable, column: SQLiteColumn, userId: number): Promise<number> {
  const row = await ctx.db.select({ n: count() }).from(table).where(eq(column, userId)).get();
  return row!.n;
}

/** Link-account flow states in the verifications table that name `userId`. */
async function linkStatesFor(userId: number): Promise<number> {
  const rows = await ctx.db.select().from(schema.verifications).all();
  return rows.filter((row) => {
    try {
      return String(JSON.parse(row.value)?.link?.userId) === String(userId);
    } catch {
      return false;
    }
  }).length;
}

/** Rows that reference `userId`, per table, in the column that references users.id. */
async function referencesTo(userId: number) {
  return {
    sessions: await countWhere(schema.sessions, schema.sessions.userId, userId),
    accounts: await countWhere(schema.accounts, schema.accounts.userId, userId),
    pendingOAuthLinks: await countWhere(schema.pendingOAuthLinks, schema.pendingOAuthLinks.userId, userId),
    linkStates: await linkStatesFor(userId),
    apiTokens: await countWhere(schema.apiTokens, schema.apiTokens.createdBy, userId),
    groupMembers: await countWhere(schema.groupMembers, schema.groupMembers.userId, userId),
    forwardAuthAccess: await countWhere(schema.forwardAuthAccess, schema.forwardAuthAccess.userId, userId),
    forwardAuthSessions: await countWhere(schema.forwardAuthSessions, schema.forwardAuthSessions.userId, userId),
    auditEvents: await countWhere(schema.auditEvents, schema.auditEvents.userId, userId),
    proxyHosts: await countWhere(schema.proxyHosts, schema.proxyHosts.ownerUserId, userId),
    l4ProxyHosts: await countWhere(schema.l4ProxyHosts, schema.l4ProxyHosts.ownerUserId, userId),
    accessLists: await countWhere(schema.accessLists, schema.accessLists.createdBy, userId),
    certificates: await countWhere(schema.certificates, schema.certificates.createdBy, userId),
    caCertificates: await countWhere(schema.caCertificates, schema.caCertificates.createdBy, userId),
    issuedClientCertificates:
      await countWhere(schema.issuedClientCertificates, schema.issuedClientCertificates.createdBy, userId),
    mtlsRoles: await countWhere(schema.mtlsRoles, schema.mtlsRoles.createdBy, userId),
    mtlsAccessRules: await countWhere(schema.mtlsAccessRules, schema.mtlsAccessRules.createdBy, userId),
    groups: await countWhere(schema.groups, schema.groups.createdBy, userId),
  };
}

type References = Awaited<ReturnType<typeof referencesTo>>;

/** What seedReferences adds for one user. */
const SEEDED: References = {
  sessions: 1, accounts: 1, pendingOAuthLinks: 1, linkStates: 2, apiTokens: 1, groupMembers: 1,
  forwardAuthAccess: 1, forwardAuthSessions: 1, auditEvents: 1, proxyHosts: 1, l4ProxyHosts: 1,
  accessLists: 1, certificates: 1, caCertificates: 1, issuedClientCertificates: 1, mtlsRoles: 1,
  mtlsAccessRules: 1, groups: 1,
};
const NONE = Object.fromEntries(Object.keys(SEEDED).map((key) => [key, 0])) as References;

/** Rows whose user column (onDelete: "set null") is null, per table. */
async function rowsWithoutUser() {
  const nulls = async (table: SQLiteTable, column: SQLiteColumn) =>
    (await ctx.db.select({ n: count() }).from(table).where(sql`${column} is null`).get())!.n;
  return {
    auditEvents: await nulls(schema.auditEvents, schema.auditEvents.userId),
    proxyHosts: await nulls(schema.proxyHosts, schema.proxyHosts.ownerUserId),
    l4ProxyHosts: await nulls(schema.l4ProxyHosts, schema.l4ProxyHosts.ownerUserId),
    accessLists: await nulls(schema.accessLists, schema.accessLists.createdBy),
    certificates: await nulls(schema.certificates, schema.certificates.createdBy),
    caCertificates: await nulls(schema.caCertificates, schema.caCertificates.createdBy),
    issuedClientCertificates: await nulls(schema.issuedClientCertificates, schema.issuedClientCertificates.createdBy),
    mtlsRoles: await nulls(schema.mtlsRoles, schema.mtlsRoles.createdBy),
    mtlsAccessRules: await nulls(schema.mtlsAccessRules, schema.mtlsAccessRules.createdBy),
    groups: await nulls(schema.groups, schema.groups.createdBy),
  };
}

async function exchangesFor(forwardAuthSessionId: number): Promise<number> {
  return countWhere(schema.forwardAuthExchanges, schema.forwardAuthExchanges.sessionId, forwardAuthSessionId);
}

const migrationsFolder = resolve(process.cwd(), 'drizzle');

/** A database with foreign keys off (as in production) and the migrations up to and including `lastTag`. */
function databaseMigratedTo(lastTag: string): TestDb {
  const folder = mkdtempSync(join(tmpdir(), 'cpm-migrations-'));
  try {
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.map((entry) => entry.tag)).toContain(lastTag);
    journal.entries = journal.entries.filter((entry) => entry.tag <= lastTag);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = drizzle(new Database(':memory:'), { schema, casing: 'snake_case' });
    db.run(sql`PRAGMA foreign_keys = OFF`);
    migrate(db, { migrationsFolder: folder });
    return db;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The accounts the primary admin has, by providerId. */
async function adminAccounts(): Promise<string[]> {
  const rows = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.userId, 1)).all();
  return rows.map((row) => row.providerId);
}

describe('deleteUser with foreign keys off', () => {
  it('runs against a database that does not cascade', () => {
    expect(ctx.db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 0 });
  });

  it('covers every reference to users.id in the schema', () => {
    // deleteUserReferences and referencesTo handle exactly these; a new
    // reference has to be added to both.
    const references = (Object.values(schema) as unknown[])
      .filter((value): value is SQLiteTable => is(value, SQLiteTable))
      .flatMap((table) => {
        const { name, foreignKeys } = getTableConfig(table);
        return foreignKeys
          .filter((foreignKey) => foreignKey.reference().foreignTable === schema.users)
          .map((foreignKey) => `${name}.${foreignKey.reference().columns[0].name} ${foreignKey.onDelete}`);
      });
    expect(references.sort()).toEqual([
      'access_lists.createdBy set null',
      'accounts.userId cascade',
      'api_tokens.createdBy cascade',
      'audit_events.userId set null',
      'ca_certificates.createdBy set null',
      'certificates.createdBy set null',
      'forward_auth_access.userId cascade',
      'forward_auth_sessions.userId cascade',
      'group_members.userId cascade',
      'groups.createdBy set null',
      'issued_client_certificates.createdBy set null',
      'l4_proxy_hosts.ownerUserId set null',
      'mtls_access_rules.createdBy set null',
      'mtls_roles.createdBy set null',
      'pending_oauth_links.userId cascade',
      'proxy_hosts.ownerUserId set null',
      'sessions.userId cascade',
    ]);
  });

  it("deletes the user's rows and clears the user from rows that only record it", async () => {
    const doomed = await seedUser('doomed@example.com');
    const kept = await seedUser('kept@example.com');
    const doomedRefs = await seedReferences(doomed);
    const keptRefs = await seedReferences(kept);
    await ctx.db.insert(schema.verifications).values({
      identifier: 'unrelated', value: 'not json', expiresAt: new Date().toISOString(),
    });
    expect(await referencesTo(doomed)).toEqual(SEEDED);

    await deleteUser(doomed);

    expect(await getUserById(doomed)).toBeNull();
    expect(await referencesTo(doomed)).toEqual(NONE);
    expect(await exchangesFor(doomedRefs.forwardAuthSessionId)).toBe(0);
    expect(await validateToken(doomedRefs.rawToken)).toBeNull();
    // The rows themselves survive, without a user.
    expect(Object.values(await rowsWithoutUser())).toEqual(Array(10).fill(1));
    const audit = await ctx.db.select().from(schema.auditEvents).all();
    expect(audit.map((event) => event.userId).sort()).toEqual([kept, null].sort());

    // Nothing of the other user changes.
    expect(await referencesTo(kept)).toEqual(SEEDED);
    expect(await exchangesFor(keptRefs.forwardAuthSessionId)).toBe(1);
    expect(await validateToken(keptRefs.rawToken)).not.toBeNull();
    expect(await ctx.db.select().from(schema.verifications).where(eq(schema.verifications.identifier, 'unrelated')).get())
      .toBeDefined();
  });

  it('leaves nothing for a primary admin recreated after deleteUser', { timeout: 20_000 }, async () => {
    await ensureAdminUser();
    const { rawToken, forwardAuthSessionId } = await seedReferences(1);
    expect(await validateToken(rawToken)).not.toBeNull();

    await deleteUser(1);
    await ensureAdminUser();

    expect((await getUserById(1))?.role).toBe('admin');
    expect(await validateToken(rawToken)).toBeNull();
    expect(await exchangesFor(forwardAuthSessionId)).toBe(0);
    // Only the credential account ensureAdminUser creates.
    expect(await adminAccounts()).toEqual(['credential']);
    expect(await referencesTo(1)).toEqual({ ...NONE, accounts: 1 });
  });
});

describe('ensureAdminUser after a deletion that did not cascade', { timeout: 20_000 }, () => {
  it('clears what the deleted primary admin left under its id', async () => {
    await ensureAdminUser();
    const { rawToken, forwardAuthSessionId } = await seedReferences(1);
    // What deleteUser did before it cascaded: only the users row goes.
    await ctx.db.delete(schema.users).where(eq(schema.users.id, 1));
    expect(await referencesTo(1)).toEqual({ ...SEEDED, accounts: 2 });

    await ensureAdminUser();

    expect((await getUserById(1))?.role).toBe('admin');
    expect(await validateToken(rawToken)).toBeNull();
    expect(await exchangesFor(forwardAuthSessionId)).toBe(0);
    expect(await adminAccounts()).toEqual(['credential']);
    expect(await referencesTo(1)).toEqual({ ...NONE, accounts: 1 });
    expect((await rowsWithoutUser()).auditEvents).toBe(1);
  });

  it('clears what any deleted user left before a users-table rebuild hands its id out again', async () => {
    // A release before migration 0022, where deleteUser removed only the users row.
    ctx.db = databaseMigratedTo('0021_camelcase_columns');
    await seedUser('admin@example.com');
    const kept = await seedUser('kept@example.com');
    const doomed = await seedUser('doomed@example.com');
    await ctx.db.delete(schema.users).where(eq(schema.users.id, doomed));

    // The upgrade: 0022 rebuilds the users table, which resets its
    // AUTOINCREMENT counter to the highest id left.
    migrate(ctx.db, { migrationsFolder });
    const keptRefs = await seedReferences(kept);
    const doomedRefs = await seedReferences(doomed);
    // A link-account flow that is all another deleted user left, and
    // verification rows that are not link-account flows.
    const now = new Date().toISOString();
    for (const [identifier, value] of [
      ['state-only', JSON.stringify({ codeVerifier: 'verifier', link: { email: 'gone@example.com', userId: '7' } })],
      ['sign-in-state', JSON.stringify({ codeVerifier: 'verifier', callbackURL: 'https://cpm.example.com/' })],
      ['not-json', 'not json'],
    ]) {
      await ctx.db.insert(schema.verifications).values({ identifier, value, expiresAt: now, createdAt: now, updatedAt: now });
    }

    await ensureAdminUser();
    const newcomer = await seedUser('new@example.com');

    expect(newcomer).toBe(doomed);
    expect(await referencesTo(newcomer)).toEqual(NONE);
    expect(await validateToken(doomedRefs.rawToken)).toBeNull();
    expect(await exchangesFor(doomedRefs.forwardAuthSessionId)).toBe(0);
    expect(Object.values(await rowsWithoutUser())).toEqual(Array(10).fill(1));
    expect(await linkStatesFor(7)).toBe(0);
    expect(await referencesTo(kept)).toEqual(SEEDED);
    expect(await validateToken(keptRefs.rawToken)).not.toBeNull();
    expect(await exchangesFor(keptRefs.forwardAuthSessionId)).toBe(1);
    const verifications = await ctx.db.select({ identifier: schema.verifications.identifier })
      .from(schema.verifications).all();
    expect(verifications.map((row) => row.identifier)).toEqual(expect.arrayContaining(['sign-in-state', 'not-json']));
  });

  it('keeps verification rows that are not link-account states when no user exists yet', async () => {
    const now = new Date().toISOString();
    for (const [identifier, value] of [
      ['sign-in-state', JSON.stringify({ codeVerifier: 'verifier', callbackURL: 'https://cpm.example.com/' })],
      ['not-json', 'not json'],
    ]) {
      await ctx.db.insert(schema.verifications).values({ identifier, value, expiresAt: now, createdAt: now, updatedAt: now });
    }
    expect(await ctx.db.select({ n: count() }).from(schema.users).get()).toEqual({ n: 0 });

    await ensureAdminUser();

    const verifications = await ctx.db.select({ identifier: schema.verifications.identifier })
      .from(schema.verifications).all();
    expect(verifications.map((row) => row.identifier).sort()).toEqual(['not-json', 'sign-in-state']);
  });

  it('keeps the rows of an admin that still exists', async () => {
    await ensureAdminUser();
    await seedReferences(1);

    await ensureAdminUser();

    expect(await referencesTo(1)).toEqual({ ...SEEDED, accounts: 2 });
  });
});
