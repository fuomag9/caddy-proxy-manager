import db, { nowIso, toIso } from "../db";
import { users, accounts } from "../db/schema";
import { and, count, eq } from "drizzle-orm";
import { deleteUserForwardAuthSessions } from "./forward-auth";

export type User = {
  id: number;
  email: string;
  name: string | null;
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
  const account = await db.select().from(accounts).where(
    and(eq(accounts.providerId, provider), eq(accounts.accountId, subject))
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
}): Promise<User> {
  const now = nowIso();
  const role = data.role ?? "user";
  const email = data.email.trim().toLowerCase();

  const [user] = await db
    .insert(users)
    .values({
      email,
      name: data.name ?? null,
      passwordHash: data.passwordHash ?? null,
      role,
      provider: data.provider,
      subject: data.subject,
      avatarUrl: data.avatarUrl ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now
    })
    .returning();

  return parseDbUser(user);
}

export async function updateUserProfile(userId: number, data: { email?: string; name?: string | null; avatarUrl?: string | null }): Promise<User | null> {
  const current = await getUserById(userId);
  if (!current) {
    return null;
  }

  const now = nowIso();
  const [updated] = await db
    .update(users)
    .set({
      email: data.email ?? current.email,
      name: data.name ?? current.name,
      avatarUrl: data.avatarUrl ?? current.avatarUrl,
      updatedAt: now
    })
    .where(eq(users.id, userId))
    .returning();

  return updated ? parseDbUser(updated) : null;
}

export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
  const now = nowIso();
  await db
    .update(users)
    .set({
      passwordHash,
      updatedAt: now
    })
    .where(eq(users.id, userId));

  // Also update the Better Auth credential account so the new password takes effect there too
  await db
    .update(accounts)
    .set({
      password: passwordHash,
      updatedAt: now,
    })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
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
