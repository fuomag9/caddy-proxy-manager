import db, { nowIso, toIso } from "../db";
import { users } from "../db/schema";
import { and, count, eq } from "drizzle-orm";

export type User = {
  id: number;
  email: string;
  name: string | null;
  password_hash: string | null;
  role: "admin" | "user" | "viewer";
  provider: string;
  subject: string;
  avatar_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type DbUser = typeof users.$inferSelect;

function parseDbUser(user: DbUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    password_hash: user.passwordHash,
    role: user.role as "admin" | "user" | "viewer",
    provider: user.provider,
    subject: user.subject,
    avatar_url: user.avatarUrl,
    status: user.status,
    created_at: toIso(user.createdAt)!,
    updated_at: toIso(user.updatedAt)!
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
  const user = await db.query.users.findFirst({
    where: (table, operators) => and(operators.eq(table.provider, provider), operators.eq(table.subject, subject))
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
  avatar_url?: string | null;
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
      avatarUrl: data.avatar_url ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now
    })
    .returning();

  return parseDbUser(user);
}

export async function updateUserProfile(userId: number, data: { email?: string; name?: string | null; avatar_url?: string | null }): Promise<User | null> {
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
      avatarUrl: data.avatar_url ?? current.avatar_url,
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
  return updated ? parseDbUser(updated) : null;
}

export async function deleteUser(userId: number): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
