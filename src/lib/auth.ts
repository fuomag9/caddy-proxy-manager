import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "./auth-server";
import { getUserById } from "./models/user";

export type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    provider?: string;
    image?: string | null;
  };
};

/**
 * Get the current session, optionally from a specific request.
 *
 * - `auth()` — uses `headers()` from next/headers (server components, route handlers)
 * - `auth(req)` — uses request headers (middleware)
 *
 * Returns `Session | null`. The user's role is always fetched fresh from the database
 * so that role changes (e.g. demotion) take effect immediately.
 */
export async function auth(req?: NextRequest): Promise<Session | null> {
  const hdrs = req
    ? req.headers
    : (await import("next/headers")).headers();

  // headers() in Next.js 15+ returns a Promise
  const resolvedHeaders = hdrs instanceof Promise ? await hdrs : hdrs;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let betterAuthSession: any;
  try {
    betterAuthSession = await getAuth().api.getSession({
      headers: resolvedHeaders,
    });
  } catch {
    return null;
  }

  if (!betterAuthSession?.user) {
    return null;
  }

  const baUser = betterAuthSession.user as {
    id: string | number;
    name?: string | null;
    email: string;
    image?: string | null;
    role?: string;
    provider?: string;
    status?: string;
    avatarUrl?: string | null;
    subject?: string;
  };
  const userId = typeof baUser.id === "string" ? Number(baUser.id) : baUser.id;

  // Always fetch current role/status from database to reflect changes immediately
  const currentUser = await getUserById(userId);
  if (!currentUser || currentUser.status !== "active") {
    return null;
  }

  return {
    user: {
      id: String(currentUser.id),
      email: currentUser.email,
      name: currentUser.name,
      role: currentUser.role,
      provider: currentUser.provider || baUser.provider,
      image: currentUser.avatarUrl ?? (baUser.avatarUrl as string | null | undefined) ?? null,
    },
  };
}

/**
 * Alias for auth() — get the current session on the server.
 */
export async function getSession(): Promise<Session | null> {
  return auth();
}

/**
 * Require authentication. Redirects to /login if not authenticated.
 */
export async function requireUser(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    const { redirect } = await import("next/navigation");
    const { config } = await import("./config");
    redirect(`${config.basePath}/login`);
    throw new Error("Redirecting to login"); // TypeScript doesn't know redirect() never returns
  }
  return session;
}

/**
 * Require admin privileges. Throws if not authenticated or not admin.
 */
export async function requireAdmin(): Promise<Session> {
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
