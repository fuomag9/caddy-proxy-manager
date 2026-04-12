import { createHash, randomBytes } from "node:crypto";
import db, { nowIso, toIso } from "../db";
import { apiTokens } from "../db/schema";
import { count, eq } from "drizzle-orm";
import { NotFoundError } from "../api-auth";

export type ApiToken = {
  id: number;
  name: string;
  createdBy: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

type ApiTokenRow = typeof apiTokens.$inferSelect;

function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt)!,
    lastUsedAt: row.lastUsedAt ? toIso(row.lastUsedAt) : null,
    expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
  };
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

const MAX_TOKENS_PER_USER = 10;
const MAX_TOKEN_NAME_LENGTH = 100;

export async function createApiToken(
  name: string,
  createdBy: number,
  expiresAt?: string
): Promise<{ token: ApiToken; rawToken: string }> {
  const trimmedName = name.trim();
  if (trimmedName.length > MAX_TOKEN_NAME_LENGTH) {
    throw new Error(`Token name must be ${MAX_TOKEN_NAME_LENGTH} characters or fewer`);
  }

  // Enforce per-user token limit
  const existingCount = await db
    .select({ value: count() })
    .from(apiTokens)
    .where(eq(apiTokens.createdBy, createdBy));
  if (existingCount[0] && existingCount[0].value >= MAX_TOKENS_PER_USER) {
    throw new Error(`Maximum of ${MAX_TOKENS_PER_USER} API tokens per user`);
  }

  // Validate expires_at is a valid ISO 8601 date in the future
  let validatedExpiresAt: string | null = null;
  if (expiresAt) {
    const parsed = new Date(expiresAt);
    if (isNaN(parsed.getTime())) {
      throw new Error("expires_at must be a valid ISO 8601 date");
    }
    if (parsed <= new Date()) {
      throw new Error("expires_at must be in the future");
    }
    validatedExpiresAt = parsed.toISOString();
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const now = nowIso();

  const [row] = await db
    .insert(apiTokens)
    .values({
      name: name.trim(),
      tokenHash,
      createdBy,
      createdAt: now,
      expiresAt: validatedExpiresAt,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create API token");
  }

  return { token: toApiToken(row), rawToken };
}

export async function listApiTokens(userId: number): Promise<ApiToken[]> {
  const rows = await db.query.apiTokens.findMany({
    where: (table, { eq }) => eq(table.createdBy, userId),
    orderBy: (table, { desc }) => desc(table.createdAt),
  });
  return rows.map(toApiToken);
}

export async function listAllApiTokens(): Promise<ApiToken[]> {
  const rows = await db.query.apiTokens.findMany({
    orderBy: (table, { desc }) => desc(table.createdAt),
  });
  return rows.map(toApiToken);
}

export async function deleteApiToken(id: number, userId: number): Promise<void> {
  // Check ownership — fetch the token first
  const token = await db.query.apiTokens.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });

  if (!token) {
    throw new NotFoundError("Token not found");
  }

  // Check if the user owns the token or is an admin
  if (token.createdBy !== userId) {
    const user = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    if (!user || user.role !== "admin") {
      throw new Error("Forbidden");
    }
  }

  await db.delete(apiTokens).where(eq(apiTokens.id, id));
}

const LAST_USED_DEBOUNCE_MS = 60_000; // 60 seconds

export async function validateToken(
  rawToken: string
): Promise<{ token: ApiToken; user: { id: number; role: string } } | null> {
  const tokenHash = hashToken(rawToken);

  const row = await db.query.apiTokens.findFirst({
    where: (table, { eq }) => eq(table.tokenHash, tokenHash),
  });

  if (!row) {
    return null;
  }

  // Check expiry — reject tokens with invalid or past expiry dates
  if (row.expiresAt) {
    const expiresAt = new Date(row.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return null;
    }
  }

  // Load the creator user
  const user = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, row.createdBy),
  });

  if (!user || user.status !== "active") {
    return null;
  }

  // Debounced lastUsedAt update
  const now = new Date();
  const lastUsed = row.lastUsedAt ? new Date(row.lastUsedAt) : null;
  if (!lastUsed || now.getTime() - lastUsed.getTime() > LAST_USED_DEBOUNCE_MS) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: nowIso() })
      .where(eq(apiTokens.id, row.id));
  }

  return {
    token: toApiToken(row),
    user: { id: user.id, role: user.role },
  };
}
