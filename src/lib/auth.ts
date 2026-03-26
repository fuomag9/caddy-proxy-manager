import NextAuth, { type DefaultSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import Credentials from "next-auth/providers/credentials";
import type { OAuthConfig } from "next-auth/providers";
import bcrypt from "bcryptjs";
import db from "./db";
import { config } from "./config";
import { findUserByProviderSubject, createUser, getUserById } from "./models/user";
import { createAuditEvent } from "./models/audit";
import { decideLinkingStrategy, createLinkingToken, storeLinkingToken, autoLinkOAuth, linkOAuthAuthenticated } from "./services/account-linking";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      provider?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    provider?: string;
  }
}

// Credentials provider that checks against hashed passwords in the database
function createCredentialsProvider() {
  return Credentials({
    id: "credentials",
    name: "Credentials",
    credentials: {
      username: { label: "Username", type: "text" },
      password: { label: "Password", type: "password" }
    },
    async authorize(credentials) {
      const username = credentials?.username ? String(credentials.username).trim() : "";
      const password = credentials?.password ? String(credentials.password) : "";

      if (!username || !password) {
        return null;
      }

      // Look up user in database by email (constructed from username)
      const email = `${username}@localhost`;
      const user = await db.query.users.findFirst({
        where: (table, operators) => operators.eq(table.email, email)
      });

      if (!user || user.status !== "active" || !user.passwordHash) {
        return null;
      }

      // Verify password against hashed password in database
      const isValidPassword = bcrypt.compareSync(password, user.passwordHash);
      if (!isValidPassword) {
        return null;
      }

      return {
        id: user.id.toString(),
        name: user.name ?? username,
        email: user.email,
        role: user.role
      };
    }
  });
}

const credentialsProvider = createCredentialsProvider();

// Create OAuth providers based on configuration
function createOAuthProviders(): OAuthConfig<Record<string, unknown>>[] {
  const providers: OAuthConfig<Record<string, unknown>>[] = [];

  if (
    config.oauth.enabled &&
    config.oauth.clientId &&
    config.oauth.clientSecret
  ) {
    const oauthProvider: OAuthConfig<Record<string, unknown>> = {
      id: "oauth2",
      name: config.oauth.providerName,
      type: "oidc",
      clientId: config.oauth.clientId,
      clientSecret: config.oauth.clientSecret,
      issuer: config.oauth.issuer ?? undefined,
      authorization: config.oauth.authorizationUrl ?? undefined,
      token: config.oauth.tokenUrl ?? undefined,
      userinfo: config.oauth.userinfoUrl ?? undefined,
      // PKCE is the default for OIDC; state is added as defence-in-depth
      checks: ["pkce", "state"],
      profile(profile) {
        const sub = typeof profile.sub === "string" ? profile.sub : undefined;
        const id = typeof profile.id === "string" ? profile.id : undefined;
        const name = typeof profile.name === "string" ? profile.name : undefined;
        const preferredUsername =
          typeof profile.preferred_username === "string" ? profile.preferred_username : undefined;
        const email = typeof profile.email === "string" ? profile.email : undefined;
        const picture = typeof profile.picture === "string" ? profile.picture : null;
        const avatarUrl = typeof profile.avatar_url === "string" ? profile.avatar_url : null;

        return {
          id: sub ?? id,
          name: name ?? preferredUsername ?? email,
          email,
          image: picture ?? avatarUrl,
        };
      },
    };
    providers.push(oauthProvider);
  }

  return providers;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [credentialsProvider, ...createOAuthProviders()],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Credentials provider - handled by authorize function
      if (account?.provider === "credentials") {
        return true;
      }

      // OAuth provider sign-in
      if (!account || !user.email) {
        return false;
      }

      try {
        // Check if this is an OAuth linking attempt by checking the database
        const { pendingOAuthLinks } = await import("./db/schema");
        const { eq } = await import("drizzle-orm");
        const { nowIso } = await import("./db");

        // Find ALL non-expired pending links for this provider
        const allPendingLinks = await db.query.pendingOAuthLinks.findMany({
          where: (table, operators) =>
            operators.and(
              operators.eq(table.provider, account.provider),
              operators.gt(table.expiresAt, nowIso())
            )
        });

        // Security: Match by userId to prevent race condition where User B could
        // overwrite User A's pending link. We verify by checking which user exists.
        let pendingLink = null;
        if (allPendingLinks.length === 1) {
          // Common case: only one user is linking this provider right now
          pendingLink = allPendingLinks[0];
        } else if (allPendingLinks.length > 1) {
          // Race condition detected: multiple users linking same provider
          // This shouldn't happen with unique index, but handle gracefully
          // Find the user whose email matches their stored email
          for (const link of allPendingLinks) {
            const existingUser = await getUserById(link.userId);
            if (existingUser && existingUser.email === link.userEmail) {
              pendingLink = link;
              break;
            }
          }
        }

        if (pendingLink) {
          try {
            const userId = pendingLink.userId;
            const existingUser = await getUserById(userId);

            if (existingUser) {
              // Security: Validate OAuth email matches the authenticated user's stored email
              // This prevents users from linking arbitrary OAuth accounts to their credentials account
              if (user.email && (
                existingUser.email !== pendingLink.userEmail ||
                user.email.toLowerCase() !== pendingLink.userEmail.toLowerCase()
              )) {
                console.error(`OAuth linking rejected: user email mismatch. Expected ${pendingLink.userEmail}, got ${existingUser.email} (OAuth provider returned ${user.email})`);

                // Clean up the pending link
                await db.delete(pendingOAuthLinks).where(eq(pendingOAuthLinks.id, pendingLink.id));

                // Audit log for security event
                await createAuditEvent({
                  userId: existingUser.id,
                  action: "oauth_link_rejected",
                  entityType: "user",
                  entityId: existingUser.id,
                  summary: `OAuth linking rejected: email mismatch`,
                  data: JSON.stringify({
                    provider: account.provider,
                    expectedEmail: pendingLink.userEmail,
                    actualEmail: existingUser.email
                  })
                });

                return false;
              }

              // User is already authenticated - auto-link
              const linked = await linkOAuthAuthenticated(
                userId,
                account.provider,
                account.providerAccountId,
                user.image
              );

              if (linked) {
                // Reload user from database to get updated data
                const updatedUser = await getUserById(userId);

                if (updatedUser) {
                  user.id = updatedUser.id.toString();
                  user.role = updatedUser.role;
                  user.provider = updatedUser.provider;
                  user.email = updatedUser.email;
                  user.name = updatedUser.name;

                  // Delete the pending link
                  await db.delete(pendingOAuthLinks).where(eq(pendingOAuthLinks.id, pendingLink.id));

                  // Audit log
                  await createAuditEvent({
                    userId: updatedUser.id,
                    action: "account_linked",
                    entityType: "user",
                    entityId: updatedUser.id,
                    summary: `OAuth account linked while authenticated: ${account.provider}`,
                    data: JSON.stringify({ provider: account.provider, email: user.email })
                  });

                  return true;
                }
              }
            }
          } catch (e) {
            console.error("Error processing pending link:", e);
          }
        }

        // Check if OAuth account already exists
        const existingOAuthUser = await findUserByProviderSubject(
          account.provider,
          account.providerAccountId
        );

        if (existingOAuthUser) {
          // Existing OAuth user - update user object and allow sign-in
          user.id = existingOAuthUser.id.toString();
          user.role = existingOAuthUser.role;
          user.provider = existingOAuthUser.provider;

          // Audit log
          await createAuditEvent({
            userId: existingOAuthUser.id,
            action: "oauth_signin",
            entityType: "user",
            entityId: existingOAuthUser.id,
            summary: `User signed in via ${account.provider}`,
            data: JSON.stringify({ provider: account.provider })
          });

          return true;
        }

        // Determine linking strategy
        const decision = await decideLinkingStrategy(
          account.provider,
          account.providerAccountId,
          user.email
        );

        if (decision.action === "auto_link" && decision.userId) {
          // Auto-link OAuth to existing account without password
          const linked = await autoLinkOAuth(
            decision.userId,
            account.provider,
            account.providerAccountId,
            user.image
          );

          if (linked) {
            const linkedUser = await getUserById(decision.userId);
            if (linkedUser) {
              user.id = linkedUser.id.toString();
              user.role = linkedUser.role;
              user.provider = linkedUser.provider;

              // Audit log
              await createAuditEvent({
                userId: linkedUser.id,
                action: "account_linked",
                entityType: "user",
                entityId: linkedUser.id,
                summary: `OAuth account auto-linked: ${account.provider}`,
                data: JSON.stringify({ provider: account.provider, email: user.email })
              });

              return true;
            }
          }
        }

        if (decision.action === "require_manual_link" && decision.userId) {
          // Email collision - require manual linking with password verification
          const linkingToken = await createLinkingToken(
            decision.userId,
            account.provider,
            account.providerAccountId,
            user.email
          );

          const linkingId = await storeLinkingToken(linkingToken);

          // Redirect to link-account page with opaque ID (not the JWT)
          throw new Error(`LINKING_REQUIRED:${linkingId}`);
        }

        // New OAuth user - create account (defaults to admin role)
        const newUser = await createUser({
          email: user.email,
          name: user.name,
          provider: account.provider,
          subject: account.providerAccountId,
          avatar_url: user.image
        });

        user.id = newUser.id.toString();
        user.role = newUser.role;
        user.provider = newUser.provider;

        // Audit log
        await createAuditEvent({
          userId: newUser.id,
          action: "oauth_signup",
          entityType: "user",
          entityId: newUser.id,
          summary: `New user created via ${account.provider} OAuth`,
          data: JSON.stringify({ provider: account.provider, email: user.email })
        });

        return true;
      } catch (error) {
        // LINKING_REQUIRED is expected flow — rethrow so NextAuth can redirect
        if (error instanceof Error && error.message.startsWith("LINKING_REQUIRED:")) {
          throw error;
        }

        console.error("OAuth sign-in error:", error);

        // Audit log for failed OAuth attempts
        try {
          await createAuditEvent({
            userId: null,
            action: "oauth_signin_failed",
            entityType: "user",
            entityId: null,
            summary: `OAuth sign-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            data: JSON.stringify({
              provider: account?.provider,
              email: user?.email,
              error: error instanceof Error ? error.message : String(error)
            })
          });
        } catch (auditError) {
          console.error("Failed to create audit log for OAuth error:", auditError);
        }

        return false;
      }
    },
    async jwt({ token, user, account }) {
      // On sign in, add user info to token
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = user.role ?? "user";
        token.provider = account?.provider ?? user.provider ?? "credentials";
        token.image = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      // Add user info from token to session
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.provider = token.provider as string;

        // Always fetch current role from database to reflect
        // role changes (e.g. demotion) without waiting for JWT expiry
        const userId = Number(token.id);
        const currentUser = await getUserById(userId);
        if (currentUser) {
          session.user.role = currentUser.role;
          session.user.image = currentUser.avatar_url ?? (token.image as string | null | undefined);
        } else {
          // User deleted from DB — deny access by clearing session
          session.user.role = token.role as string;
          session.user.image = token.image as string | null | undefined;
        }
      }
      return session;
    },
  },
  secret: config.sessionSecret,
  // Only trust Host header when explicitly opted in or when NEXTAUTH_URL
  // is set (operator has declared the canonical URL, so Host validation is moot).
  trustHost: !!process.env.NEXTAUTH_TRUST_HOST || !!process.env.NEXTAUTH_URL,
  basePath: "/api/auth",
});

/**
 * Helper function to get the current session on the server.
 */
export async function getSession() {
  return await auth();
}

/**
 * Helper function to require authentication, throwing if not authenticated.
 */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("Redirecting to login"); // TypeScript doesn't know redirect() never returns
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== "admin") {
    throw new Error("Administrator privileges required");
  }
  return session;
}

/**
 * Defense-in-depth CSRF check: verifies the Origin header matches the Host.
 * Returns a 403 response if the origin is present and mismatched; otherwise null.
 * Browsers always include Origin on cross-origin requests, so a mismatch means
 * the request came from a different site.
 */
export function checkSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  // For mutating requests, require Origin header to be present.
  // Browsers always send Origin on cross-origin POST/PUT/DELETE.
  const method = request.method.toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!origin) {
    // Allow non-mutating requests without Origin (normal browser behavior)
    if (!isMutating) return null;
    // For mutating requests, require Origin header
    return NextResponse.json({ error: "Forbidden: Origin header required" }, { status: 403 });
  }

  const host = request.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return null;
  } catch {
    // unparseable origin — treat as mismatch
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
