import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handlers } from "@/src/lib/auth";
import { isRateLimited, registerFailedAttempt, resetAttempts } from "@/src/lib/rate-limit";

export const dynamic = 'force-dynamic';

export const { GET } = handlers;

function getClientIp(request: NextRequest): string {
  // Get client IP from headers
  // In production, ensure your reverse proxy (Caddy) sets these headers correctly
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1]?.trim() || "unknown";
  }
  const real = request.headers.get("x-real-ip");
  if (real) {
    return real.trim();
  }
  return "unknown";
}

function buildRateLimitKey(ip: string, username: string) {
  const normalizedUsername = username.trim().toLowerCase() || "unknown";
  return `login:${ip}:${normalizedUsername}`;
}

function buildBlockedResponse(retryAfterMs?: number) {
  const retryAfterSeconds = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : 60;
  const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return NextResponse.json(
    {
      error: `Too many login attempts. Try again in about ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`
    },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfterSeconds.toString()
      }
    }
  );
}

export async function POST(request: NextRequest) {
  const formData = await request.clone().formData();
  const username = String(formData.get("username") ?? "");
  const ip = getClientIp(request);
  const rateLimitKey = buildRateLimitKey(ip, username);

  const limitation = isRateLimited(rateLimitKey);
  if (limitation.blocked) {
    return buildBlockedResponse(limitation.retryAfterMs);
  }

  const response = await handlers.POST(request);

  // Determine success/failure by inspecting redirect destination, not status code.
  // Auth.js returns 302 (direct form) or 200+JSON (X-Auth-Return-Redirect) on both
  // success and failure — the error is signaled by the destination URL containing "error=".
  const isFailure = await isAuthFailureResponse(response);

  if (isFailure) {
    const result = registerFailedAttempt(rateLimitKey);
    if (result.blocked) {
      return buildBlockedResponse(result.retryAfterMs);
    }
  } else {
    resetAttempts(rateLimitKey);
  }

  return response;
}

async function isAuthFailureResponse(response: Response): Promise<boolean> {
  // Redirect case: Auth.js sets Location header
  const location = response.headers.get("location");
  if (location) {
    return location.includes("error=");
  }
  // JSON case (X-Auth-Return-Redirect: 1): body is {"url": "..."}
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 200 && contentType.includes("application/json")) {
    try {
      const cloned = response.clone();
      const body = await cloned.json() as { url?: string };
      if (typeof body.url === "string") {
        return body.url.includes("error=");
      }
    } catch {
      // ignore parse errors
    }
  }
  // Any 4xx/5xx is a failure
  return response.status >= 400;
}
