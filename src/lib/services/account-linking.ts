import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";
import { findUserByEmail, findUserByProviderSubject, getUserById } from "../models/user";
import db from "../db";
import { users, linkingTokens } from "../db/schema";
import { eq } from "drizzle-orm";
import { nowIso } from "../db";

const LINKING_TOKEN_EXPIRY = 5 * 60; // 5 minutes in seconds

export type LinkingDecision = {
  action: "auto_link" | "require_manual_link" | "create_new" | "signin_existing";
  userId?: number;
  reason: string;
};

export type LinkingTokenPayload = {
  userId: number;
  provider: string;
  providerAccountId: string;
  email: string;
  exp: number;
};

/**
 * Determines how to handle an OAuth sign-in attempt
 */
export async function decideLinkingStrategy(
  provider: string,
  providerAccountId: string,
  email: string
): Promise<LinkingDecision> {
  // Check if OAuth account already exists
  const existingOAuthUser = await findUserByProviderSubject(provider, providerAccountId);
  if (existingOAuthUser) {
    return {
      action: "signin_existing",
      userId: existingOAuthUser.id,
      reason: "OAuth account already linked"
    };
  }

  // Check if email matches existing user
  const existingEmailUser = await findUserByEmail(email);
  if (!existingEmailUser) {
    return {
      action: "create_new",
      reason: "No existing account with this email"
    };
  }

  // User exists with this email
  if (existingEmailUser.password_hash) {
    // Has password - require manual linking with password verification
    return {
      action: "require_manual_link",
      userId: existingEmailUser.id,
      reason: "Account has password - requires manual linking"
    };
  }

  // No password (OAuth-only account)
  if (config.oauth.allowAutoLinking) {
    return {
      action: "auto_link",
      userId: existingEmailUser.id,
      reason: "Account has no password - auto-linking enabled"
    };
  }

  return {
    action: "require_manual_link",
    userId: existingEmailUser.id,
    reason: "Auto-linking disabled"
  };
}

/**
 * Create a temporary linking token (5-minute expiry)
 */
export async function createLinkingToken(
  userId: number,
  provider: string,
  providerAccountId: string,
  email: string
): Promise<string> {
  const secret = new TextEncoder().encode(config.sessionSecret);

  const token = await new SignJWT({
    userId,
    provider,
    providerAccountId,
    email
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${LINKING_TOKEN_EXPIRY}s`)
    .setIssuedAt()
    .sign(secret);

  return token;
}

/**
 * Verify and decode linking token
 */
export async function verifyLinkingToken(token: string): Promise<LinkingTokenPayload | null> {
  try {
    const secret = new TextEncoder().encode(config.sessionSecret);
    const { payload } = await jwtVerify(token, secret);

    return {
      userId: payload.userId as number,
      provider: payload.provider as string,
      providerAccountId: payload.providerAccountId as string,
      email: payload.email as string,
      exp: payload.exp as number
    };
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

/**
 * Store a linking JWT in the DB and return an opaque 64-char hex ID
 */
export async function storeLinkingToken(token: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await db.insert(linkingTokens).values({
    id,
    token,
    createdAt: nowIso()
  });
  return id;
}

/**
 * Retrieve and delete a linking token by its opaque ID (one-time use).
 * Returns null if the ID is not found.
 */
export async function retrieveLinkingToken(id: string): Promise<string | null> {
  const rows = await db.select().from(linkingTokens).where(eq(linkingTokens.id, id)).limit(1);
  if (rows.length === 0) {
    return null;
  }
  const { token } = rows[0];
  await db.delete(linkingTokens).where(eq(linkingTokens.id, id));
  return token;
}

/**
 * Verify password and link OAuth account to existing user
 */
export async function verifyAndLinkOAuth(
  userId: number,
  password: string,
  provider: string,
  providerAccountId: string
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user || !user.password_hash) {
    return false;
  }

  // Verify password
  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return false;
  }

  // Update user to link OAuth
  await db
    .update(users)
    .set({
      provider,
      subject: providerAccountId,
      updatedAt: nowIso()
    })
    .where(eq(users.id, userId));

  return true;
}

/**
 * Auto-link OAuth account (for users without passwords)
 */
export async function autoLinkOAuth(
  userId: number,
  provider: string,
  providerAccountId: string,
  avatarUrl?: string | null
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Don't auto-link if user has a password (unless explicitly called for authenticated linking)
  // This check is bypassed when called from the authenticated linking flow
  if (user.password_hash && !process.env.OAUTH_ALLOW_AUTO_LINKING) {
    return false;
  }

  // Update user to link OAuth
  await db
    .update(users)
    .set({
      provider,
      subject: providerAccountId,
      avatarUrl: avatarUrl ?? user.avatar_url,
      updatedAt: nowIso()
    })
    .where(eq(users.id, userId));

  return true;
}

/**
 * Link OAuth account for an already-authenticated user
 * This bypasses the password check since the user is already authenticated
 */
export async function linkOAuthAuthenticated(
  userId: number,
  provider: string,
  providerAccountId: string,
  avatarUrl?: string | null
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Update user to link OAuth
  await db
    .update(users)
    .set({
      provider,
      subject: providerAccountId,
      avatarUrl: avatarUrl ?? user.avatar_url,
      updatedAt: nowIso()
    })
    .where(eq(users.id, userId));

  return true;
}
