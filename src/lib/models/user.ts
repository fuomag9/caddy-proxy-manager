import db, { nowIso, toIso } from "../db";
import { users, accounts, oauthProviders, sessions, forwardAuthSessions } from "../db/schema";
import { and, count, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { deleteUserForwardAuthSessions } from "./forward-auth";
import {
  CREDENTIAL_ACCOUNT_ISSUER,
  resolveOAuthAccountIssuer,
} from "../account-issuer";
import { isUsableSignInUsername, loginUsernameCandidates } from "../login-username";

export type User = {
  id: number;
  email: string;
  name: string | null;
  /** What the user types as username on the login page (see loginUsernameCandidates). */
  username: string | null;
  passwordHash: string | null;
  role: "admin" | "user" | "viewer";
  provider: string | null;
  subject: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type DbUser = typeof users.$inferSelect;

function parseDbUser(user: DbUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role as "admin" | "user" | "viewer",
    provider: user.provider,
    subject: user.subject,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: toIso(user.createdAt)!,
    updatedAt: toIso(user.updatedAt)!
  };
}

export async function getUserById(userId: number): Promise<User | null> {
  const user = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, userId)
  });
  return user ? parseDbUser(user) : null;
}

export async function getUserCount(): Promise<number> {
  const result = await db.select({ value: count() }).from(users);
  return result[0]?.value ?? 0;
}

export async function findUserByProviderSubject(provider: string, subject: string): Promise<User | null> {
  const configuredProvider = await db.select({ issuer: oauthProviders.issuer })
    .from(oauthProviders)
    .where(eq(oauthProviders.id, provider))
    .get();
  const issuer = resolveOAuthAccountIssuer(provider, configuredProvider?.issuer);
  const account = await db.select().from(accounts).where(
    and(eq(accounts.issuer, issuer), eq(accounts.accountId, subject))
  ).limit(1);

  if (account.length === 0) return null;

  const user = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, account[0].userId)
  });
  return user ? parseDbUser(user) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, normalizedEmail)
  });
  return user ? parseDbUser(user) : null;
}

export async function createUser(data: {
  email: string;
  name?: string | null;
  role?: User["role"];
  provider: string;
  subject: string;
  avatarUrl?: string | null;
  passwordHash?: string | null;
  username?: string | null;
  displayUsername?: string | null;
}): Promise<User> {
  const now = nowIso();
  const role = data.role ?? "user";
  const email = data.email.trim().toLowerCase();
  const provider = data.provider === "credential" ? "credentials" : data.provider;

  // One synchronous transaction, so no other account can take the username
  // between picking it and inserting the user.
  const user = db.transaction((tx) => {
    const username = data.username ?? allocateLoginUsername(tx, null, email);
    const displayUsername = data.displayUsername ?? data.name ?? email.split("@")[0];
    const row = tx
      .insert(users)
      .values({
        email,
        name: data.name ?? null,
        passwordHash: data.passwordHash ?? null,
        role,
        provider,
        subject: data.subject,
        avatarUrl: data.avatarUrl ?? null,
        status: "active",
        username,
        displayUsername,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();

    if (provider === "credentials" && data.passwordHash) {
      tx.insert(accounts).values({
        userId: row.id,
        issuer: CREDENTIAL_ACCOUNT_ISSUER,
        accountId: row.id.toString(),
        providerId: "credential",
        password: data.passwordHash,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    return row;
  });

  return parseDbUser(user);
}

/**
 * Updates the email, name and avatar. A user with a password the login page
 * cannot find them by (see signInNameRepair) is given a username made from
 * the resulting email, so an administrator editing the account, or changing
 * an email no username could be made from, lets them sign in again.
 */
export async function updateUserProfile(userId: number, data: { email?: string; name?: string | null; avatarUrl?: string | null }): Promise<User | null> {
  const now = nowIso();
  const updated = db.transaction((tx) => {
    const current = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!current) return null;
    const email = data.email ?? current.email;
    const name = data.name ?? current.name;
    return tx
      .update(users)
      .set({
        email,
        name,
        avatarUrl: data.avatarUrl ?? current.avatarUrl,
        ...signInNameRepair(tx, { ...current, email, name }),
        updatedAt: now
      })
      .where(eq(users.id, userId))
      .returning()
      .get();
  });

  return updated ? parseDbUser(updated) : null;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbReader = Pick<DbTransaction, "select">;

/** Whether the user has a password on the credential account, the one the login page checks. */
function hasCredentialPassword(reader: DbReader, userId: number): boolean {
  return !!reader
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.userId, userId),
      eq(accounts.providerId, "credential"),
      isNotNull(accounts.password),
      ne(accounts.password, "")
    ))
    .get();
}

type SignInNameSource = Pick<DbUser, "id" | "email" | "name" | "username" | "displayUsername">;
type SignInName = { username: string; displayUsername: string };

/** The columns that give `user` the username allocateLoginUsername picks. */
function allocateSignInName(reader: DbReader, user: SignInNameSource): SignInName | null {
  const username = allocateLoginUsername(reader, user.id, user.email);
  return username
    ? { username, displayUsername: user.displayUsername ?? user.name ?? username.split("@")[0] }
    : null;
}

/**
 * The columns that give a user who has a password on the credential account,
 * but a username the login page cannot find them by, a usable one made from
 * their email; null when neither applies or every candidate is taken. Such a
 * username has never worked for signing in, so replacing it breaks nothing.
 */
function signInNameRepair(reader: DbReader, user: SignInNameSource): SignInName | null {
  if (isUsableSignInUsername(user.username) || !hasCredentialPassword(reader, user.id)) return null;
  return allocateSignInName(reader, user);
}

/**
 * The first of loginUsernameCandidates(email) that no other account signs in
 * with or has as its email address, or null when all are taken. The login
 * page lowercases what is typed, so names are compared case-insensitively.
 * `userId` is the account being given the name (null for one not created
 * yet); its own username and email do not count as taken.
 */
function allocateLoginUsername(reader: DbReader, userId: number | null, email: string): string | null {
  for (const candidate of loginUsernameCandidates(email)) {
    const holder = reader
      .select({ id: users.id })
      .from(users)
      .where(and(
        or(sql`lower(${users.username}) = ${candidate}`, sql`lower(${users.email}) = ${candidate}`),
        userId === null ? undefined : ne(users.id, userId)
      ))
      .get();
    if (!holder) return candidate;
  }
  return null;
}

/**
 * Writes the password to users.passwordHash and to the Better Auth credential
 * account, which is what the login page checks. An account without a password
 * (OAuth-only) has no credential account yet, so one is created.
 *
 * The login page signs in by username. A user without one it can find (users
 * provisioned by an OAuth sign-in have none; older accounts can hold an email
 * it refuses, such as one with a '+') is given one made from their email by
 * allocateLoginUsername; a usable username is kept. The SQLite driver is
 * synchronous, so this runs inside a synchronous transaction.
 */
function writeUserPassword(tx: DbTransaction, userId: number, passwordHash: string, now: string): void {
  const user = tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
      displayUsername: users.displayUsername,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const signInName = user && !isUsableSignInUsername(user.username) ? allocateSignInName(tx, user) : null;

  tx.update(users)
    .set({ passwordHash, ...signInName, updatedAt: now })
    .where(eq(users.id, userId))
    .run();

  const updated = tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: now })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .returning({ id: accounts.id })
    .all();
  if (updated.length === 0) {
    tx.insert(accounts)
      .values({
        userId,
        issuer: CREDENTIAL_ACCOUNT_ISSUER,
        accountId: userId.toString(),
        providerId: "credential",
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * Gives every user who has a password on the credential account, but a
 * username the login page cannot find them by, one made from their email
 * (see signInNameRepair). Older releases stored the email as it was, such as
 * alice+cpm@example.com, which the login page refuses; users without OAuth
 * could then not sign in to change anything. It needs nobody to sign in, so
 * it suits startup. Returns the usernames it gave out; accounts whose
 * candidates are all taken are skipped.
 */
export async function repairLoginUsernames(): Promise<Array<{ userId: number; username: string }>> {
  const now = nowIso();
  return db.transaction((tx) => {
    const unusable = tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        username: users.username,
        displayUsername: users.displayUsername,
      })
      .from(users)
      .orderBy(users.id)
      .all()
      .filter((user) => !isUsableSignInUsername(user.username));
    const repaired: Array<{ userId: number; username: string }> = [];
    for (const user of unusable) {
      const signInName = signInNameRepair(tx, user);
      if (!signInName) continue;
      tx.update(users).set({ ...signInName, updatedAt: now }).where(eq(users.id, user.id)).run();
      repaired.push({ userId: user.id, username: signInName.username });
    }
    return repaired;
  });
}

/**
 * Sets a user's password and ends their other sign-ins: every management
 * session except `keepSessionId` (the caller's, or null to end them all) and
 * every forward-auth session. It runs as one transaction, so the password
 * never changes without the revocation or the other way round. API tokens are
 * separate credentials and are left alone.
 */
export async function changeUserPassword(
  userId: number,
  passwordHash: string,
  keepSessionId: number | null
): Promise<void> {
  const now = nowIso();
  db.transaction((tx) => {
    writeUserPassword(tx, userId, passwordHash, now);
    tx.delete(sessions)
      .where(keepSessionId === null
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
      .run();
    tx.delete(forwardAuthSessions).where(eq(forwardAuthSessions.userId, userId)).run();
  });
}

/**
 * The hash of the user's password, or null when the account has none
 * (OAuth-only). Accounts CPM creates keep it in users.passwordHash; Better
 * Auth's self-registration writes it only to the credential account. The
 * change-password route and the profile page use it to decide whether a
 * current password has to be proven.
 */
export async function getUserPasswordHash(user: Pick<User, "id" | "passwordHash">): Promise<string | null> {
  if (user.passwordHash) return user.passwordHash;
  const credential = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(
      eq(accounts.userId, user.id),
      eq(accounts.providerId, "credential"),
      isNotNull(accounts.password)
    ))
    .get();
  return credential?.password || null;
}

/**
 * The username the user signs in with on the login page, or null when that
 * page cannot sign them in without OAuth. It looks the user up by username and
 * checks the password on the credential account, so both have to exist; a
 * password kept only in users.passwordHash does not count. Unlinking OAuth,
 * and the profile page's unlink button, go through here so the last working
 * sign-in method cannot be removed.
 */
export async function getPasswordSignInUsername(userId: number): Promise<string | null> {
  const row = await db
    .select({ username: users.username })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(
      eq(accounts.userId, userId),
      eq(accounts.providerId, "credential"),
      isNotNull(accounts.password),
      ne(accounts.password, "")
    ))
    .get();
  return isUsableSignInUsername(row?.username) ? row.username : null;
}

/**
 * Why the login page cannot sign a user in with a password:
 *  - "no-credential": it has no username and password pair for them yet. The
 *    password is not on the credential account, or the account has no usable
 *    username; setting or changing the password sets up both.
 *  - "no-username": no usable username can be made from the account's email
 *    (see allocateLoginUsername), so no password change helps. Changing the
 *    email (updateUserProfile) gives a user with a password one right away.
 */
export type PasswordSignInBlocker = "no-credential" | "no-username";

export type PasswordSignInStatus =
  | { username: string; blocker: null }
  | { username: null; blocker: PasswordSignInBlocker };

/** getPasswordSignInUsername plus, when that is null, the reason. */
export async function getPasswordSignInStatus(userId: number): Promise<PasswordSignInStatus> {
  const username = await getPasswordSignInUsername(userId);
  if (username) return { username, blocker: null };
  const user = await db
    .select({ email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const canGetUsername = !!user &&
    (isUsableSignInUsername(user.username) || allocateLoginUsername(db, userId, user.email) !== null);
  return { username: null, blocker: canGetUsername ? "no-credential" : "no-username" };
}

/**
 * The OAuth identities linked to a user, read from the authoritative
 * `accounts` table (Better Auth writes federated identities there).
 *
 * The informational `users.provider` / `users.subject` columns are a cached
 * projection of this table and are re-derived via {@link syncUserOAuthIdentity};
 * the Profile page must read connection state from here so a stale projection
 * can never make a linked account look unlinked (or vice versa). (#261)
 */
export async function listUserOAuthProviders(userId: number): Promise<Array<{ providerId: string; accountId: string }>> {
  return db
    .select({ providerId: accounts.providerId, accountId: accounts.accountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.providerId, "credential")))
    .orderBy(desc(accounts.id))
    .all();
}

/**
 * Re-derive `users.provider` / `users.subject` from the authoritative
 * `accounts` table.
 *
 * Better Auth only writes to `accounts` when an OAuth identity is linked
 * (auto-link, profile link, federated sign-up), so without this sync the two
 * representations drift apart and the Profile UI reports the wrong connection
 * state in both directions (#261). The most recently created OAuth account
 * wins; with no OAuth identity left the user falls back to their credential
 * account ("credentials"), or to null when they have neither.
 */
export async function syncUserOAuthIdentity(userId: number): Promise<void> {
  const [oauthAccount] = await db
    .select({ providerId: accounts.providerId, accountId: accounts.accountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.providerId, "credential")))
    .orderBy(desc(accounts.id))
    .limit(1);

  const now = nowIso();
  if (oauthAccount) {
    await db
      .update(users)
      .set({
        provider: oauthAccount.providerId,
        subject: oauthAccount.accountId,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    return;
  }

  const credentialAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .get();
  const user = await getUserById(userId);
  const hasCredential = !!credentialAccount || !!user?.passwordHash;

  await db
    .update(users)
    .set({
      provider: hasCredential ? "credentials" : null,
      subject: null,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

export async function listUsers(): Promise<User[]> {
  const rows = await db.query.users.findMany({
    orderBy: (table, { asc }) => asc(table.createdAt)
  });
  return rows.map(parseDbUser);
}

export async function promoteToAdmin(userId: number): Promise<void> {
  const now = nowIso();
  await db
    .update(users)
    .set({
      role: "admin",
      updatedAt: now
    })
    .where(eq(users.id, userId));
}

export async function updateUserRole(userId: number, role: User["role"]): Promise<User | null> {
  const now = nowIso();
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: now })
    .where(eq(users.id, userId))
    .returning();
  return updated ? parseDbUser(updated) : null;
}

export async function updateUserStatus(userId: number, status: string): Promise<User | null> {
  const now = nowIso();
  const [updated] = await db
    .update(users)
    .set({ status, updatedAt: now })
    .where(eq(users.id, userId))
    .returning();

  // Revoke all forward auth sessions when user is deactivated
  if (status !== "active") {
    await deleteUserForwardAuthSessions(userId);
  }

  return updated ? parseDbUser(updated) : null;
}

export async function deleteUser(userId: number): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
