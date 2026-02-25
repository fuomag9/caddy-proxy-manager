import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { applySyncPayload, getInstanceMode, getSlaveMasterToken, setSlaveLastSync, SyncPayload } from "@/src/lib/instance-sync";

const MAX_SYNC_BODY_BYTES = Number(process.env.INSTANCE_SYNC_MAX_BYTES ?? 10 * 1024 * 1024);
const SYNC_RATE_MAX = Number(process.env.INSTANCE_SYNC_RATE_MAX ?? 60);
const SYNC_RATE_WINDOW_MS = Number(process.env.INSTANCE_SYNC_RATE_WINDOW_MS ?? 60_000);
const SYNC_RATE_LIMITS = new Map<string, { count: number; windowStart: number }>();

/**
 * Timing-safe token comparison to prevent timing attacks
 */
function secureTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against dummy to maintain constant time
    const dummy = Buffer.alloc(a.length, 0);
    timingSafeEqual(Buffer.from(a), dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getClientIp(request: NextRequest): string {
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

function checkSyncRateLimit(key: string): { blocked: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = SYNC_RATE_LIMITS.get(key);

  if (!entry || entry.windowStart + SYNC_RATE_WINDOW_MS <= now) {
    SYNC_RATE_LIMITS.set(key, { count: 1, windowStart: now });
    return { blocked: false };
  }

  if (entry.count >= SYNC_RATE_MAX) {
    return { blocked: true, retryAfterMs: entry.windowStart + SYNC_RATE_WINDOW_MS - now };
  }

  entry.count += 1;
  return { blocked: false };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateArray<T>(value: unknown, validator: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(validator);
}

function isCertificate(value: unknown): value is SyncPayload["data"]["certificates"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isString(value.name) &&
    isString(value.type) &&
    isString(value.domainNames) &&
    isBoolean(value.autoRenew) &&
    isNullableString(value.providerOptions) &&
    isNullableString(value.certificatePem) &&
    isNullableString(value.privateKeyPem) &&
    isNullableNumber(value.createdBy) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isAccessList(value: unknown): value is SyncPayload["data"]["accessLists"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isString(value.name) &&
    isNullableString(value.description) &&
    isNullableNumber(value.createdBy) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isAccessListEntry(value: unknown): value is SyncPayload["data"]["accessListEntries"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isNumber(value.accessListId) &&
    isString(value.username) &&
    isString(value.passwordHash) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isProxyHost(value: unknown): value is SyncPayload["data"]["proxyHosts"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isString(value.name) &&
    isString(value.domains) &&
    isString(value.upstreams) &&
    isNullableNumber(value.certificateId) &&
    isNullableNumber(value.accessListId) &&
    isNullableNumber(value.ownerUserId) &&
    isBoolean(value.sslForced) &&
    isBoolean(value.hstsEnabled) &&
    isBoolean(value.hstsSubdomains) &&
    isBoolean(value.allowWebsocket) &&
    isBoolean(value.preserveHostHeader) &&
    isNullableString(value.meta) &&
    isBoolean(value.enabled) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isBoolean(value.skipHttpsHostnameValidation) &&
    isString(value.responseMode) &&
    isNullableNumber(value.staticStatusCode) &&
    isNullableString(value.staticResponseBody)
  );
}

/**
 * Validates that the payload has the expected structure for syncing
 */
function isValidSyncPayload(payload: unknown): payload is SyncPayload {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Check required top-level properties
  if (!("generated_at" in p) || !("settings" in p) || !("data" in p)) {
    return false;
  }

  if (!isString(p.generated_at)) {
    return false;
  }

  // Validate settings is an object
  if (p.settings !== null && typeof p.settings !== "object") {
    return false;
  }

  // Validate data has required array properties
  const data = p.data;
  if (data === null || typeof data !== "object") {
    return false;
  }

  const d = data as Record<string, unknown>;

  return (
    validateArray(d.certificates, isCertificate) &&
    validateArray(d.accessLists, isAccessList) &&
    validateArray(d.accessListEntries, isAccessListEntry) &&
    validateArray(d.proxyHosts, isProxyHost)
  );
}

export async function POST(request: NextRequest) {
  const mode = await getInstanceMode();
  if (mode !== "slave") {
    return NextResponse.json({ error: "Instance is not configured as a slave" }, { status: 403 });
  }

  const rateLimit = checkSyncRateLimit(getClientIp(request));
  if (rateLimit.blocked) {
    const retryAfterSeconds = rateLimit.retryAfterMs ? Math.ceil(rateLimit.retryAfterMs / 1000) : 60;
    return NextResponse.json(
      { error: "Too many sync requests. Please retry later." },
      { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = await getSlaveMasterToken();

  if (!expected || !secureTokenCompare(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_SYNC_BODY_BYTES) {
      return NextResponse.json({ error: "Sync payload too large" }, { status: 413 });
    }
    const bodyText = await request.text();
    if (bodyText.length > MAX_SYNC_BODY_BYTES) {
      return NextResponse.json({ error: "Sync payload too large" }, { status: 413 });
    }
    payload = JSON.parse(bodyText);
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isValidSyncPayload(payload)) {
    return NextResponse.json({ error: "Invalid sync payload structure" }, { status: 400 });
  }

  try {
    await applySyncPayload(payload);
    await applyCaddyConfig();
    await setSlaveLastSync({ ok: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply sync payload";
    await setSlaveLastSync({ ok: false, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
