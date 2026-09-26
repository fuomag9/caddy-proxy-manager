import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { extractL4ListenPort, isReservedL4Port } from "@/src/lib/l4-reserved-ports";
import { applySyncPayload, getInstanceMode, getSlaveMasterToken, setSlaveLastSync, SyncPayload } from "@/src/lib/instance-sync";
import {
  SYNC_SEALED_KEY_MISMATCH_ERROR,
  SYNC_SEALED_OPEN_FAILED_ERROR,
  SYNC_SEALED_STALE_ERROR,
} from "@/src/lib/instance-sync-error";
import {
  SYNC_KEY_CHALLENGE_PARAM,
  SyncSealError,
  createSyncKeyResponse,
  isSyncKeyId,
  isSyncNonce,
  type SyncPublicKeyResponse,
} from "@/src/lib/sync-crypto";
import { getClientIp } from "@/src/lib/client-ip";
import { createRateLimiter, type RateLimiter } from "@/src/lib/rate-limit";

const DEFAULT_MAX_SYNC_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
const _parsedMaxBytes = Number(process.env.INSTANCE_SYNC_MAX_BYTES);
const MAX_SYNC_BODY_BYTES = Number.isFinite(_parsedMaxBytes) && _parsedMaxBytes > 0
  ? _parsedMaxBytes
  : DEFAULT_MAX_SYNC_BODY_BYTES;
const SYNC_RATE_MAX = Number(process.env.INSTANCE_SYNC_RATE_MAX ?? 60);
const SYNC_RATE_WINDOW_MS = Number(process.env.INSTANCE_SYNC_RATE_WINDOW_MS ?? 60_000);
// Pre-authentication request limit per client address; every request counts.
// A fixed window: up to SYNC_RATE_MAX requests, then refusals until it ends,
// so a master syncing steadily at the limit is never refused. The master
// fetches the key before each sync, so key requests have a limiter of their
// own and do not use up the syncs.
const syncRateLimiter = createRateLimiter({
  maxAttempts: SYNC_RATE_MAX,
  windowMs: SYNC_RATE_WINDOW_MS,
  blockMs: "window",
});
const keyRateLimiter = createRateLimiter({
  maxAttempts: SYNC_RATE_MAX,
  windowMs: SYNC_RATE_WINDOW_MS,
  blockMs: "window",
});

/**
 * Timing-safe token comparison to prevent timing attacks
 */
function secureTokenCompare(a: string, b: string): boolean {
  // Hash arbitrary UTF-8 input to fixed-size buffers before comparing. This
  // avoids both length-dependent comparisons and timingSafeEqual throwing when
  // a Unicode token's byte length differs from its JavaScript string length.
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
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

function isCaCertificate(value: unknown): value is SyncPayload["data"]["caCertificates"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isString(value.name) &&
    isString(value.certificatePem) &&
    isNullableString(value.privateKeyPem) &&
    isNullableNumber(value.createdBy) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isIssuedClientCertificate(value: unknown): value is SyncPayload["data"]["issuedClientCertificates"][number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isNumber(value.caCertificateId) &&
    isString(value.commonName) &&
    isString(value.serialNumber) &&
    isString(value.fingerprintSha256) &&
    isString(value.certificatePem) &&
    isString(value.validFrom) &&
    isString(value.validTo) &&
    isNullableString(value.revokedAt) &&
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
    isBoolean(value.skipHttpsHostnameValidation)
  );
}

function isL4ProxyHost(value: unknown): value is NonNullable<SyncPayload["data"]["l4ProxyHosts"]>[number] {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isString(value.name) &&
    isString(value.protocol) &&
    isString(value.listenAddress) &&
    isString(value.upstreams) &&
    isString(value.matcherType) &&
    isNullableString(value.matcherValue) &&
    isBoolean(value.tlsTermination) &&
    isNullableString(value.proxyProtocolVersion) &&
    isBoolean(value.proxyProtocolReceive) &&
    isNullableNumber(value.ownerUserId) &&
    isNullableString(value.meta) &&
    isBoolean(value.enabled) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

/**
 * Validate semantic content of L4 proxy host fields. The listen port must not
 * collide with the ports CPM's generated Caddy config always binds itself
 * (HTTP 80/443, admin API 2019) — two listeners on the same port silently
 * split connections via SO_REUSEPORT (issue #295).
 */
function validateL4ProxyHostContent(host: Record<string, unknown>): string | null {
  if (isString(host.listenAddress) && isReservedL4Port(host.listenAddress)) {
    const port = extractL4ListenPort(host.listenAddress);
    return `L4 proxy host ${host.id}: listen port ${port} is reserved for CPM's own Caddy listeners (HTTP 80/443, admin API 2019)`;
  }
  return null;
}

/**
 * Validate semantic content of proxy host fields to prevent
 * config injection via compromised master or stolen sync token.
 */
function validateProxyHostContent(host: Record<string, unknown>): string | null {
  // Validate domains are valid hostnames
  if (typeof host.domains === "string" && host.domains) {
    try {
      const domains = JSON.parse(host.domains);
      if (Array.isArray(domains)) {
        for (const d of domains) {
          if (typeof d !== "string" || d.length > 253) {
            return `Invalid domain in proxy host ${host.id}: ${String(d).slice(0, 50)}`;
          }
        }
      }
    } catch {
      // domains might be comma-separated string; just check length
      if (host.domains.length > 5000) {
        return `Proxy host ${host.id} domains field too large`;
      }
    }
  }

  // Validate upstreams don't target dangerous internal services
  if (typeof host.upstreams === "string" && host.upstreams) {
    try {
      const upstreams = JSON.parse(host.upstreams);
      if (Array.isArray(upstreams)) {
        for (const u of upstreams) {
          if (typeof u !== "string") continue;
          const lower = u.toLowerCase();
          // Block cloud metadata endpoints
          if (lower.includes("169.254.169.254") || lower.includes("metadata.google")) {
            return `Proxy host ${host.id} upstream targets blocked metadata endpoint: ${u.slice(0, 80)}`;
          }
        }
      }
    } catch {
      // non-JSON upstreams — skip
    }
  }

  // Validate meta field size to prevent oversized config injection
  if (typeof host.meta === "string" && host.meta && host.meta.length > 100_000) {
    return `Proxy host ${host.id} meta field exceeds 100KB limit`;
  }

  return null;
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

  // A sealed payload carries a key id and a nonce, and must say exactly where
  // its sealed settings secrets are. Unsealed payloads keep the lenient
  // handling of settings_secret_paths.
  if (p.secrets_sealed_key_id !== undefined || p.secrets_sealed_nonce !== undefined) {
    if (!isSyncKeyId(p.secrets_sealed_key_id)) {
      return false;
    }
    if (!isSyncNonce(p.secrets_sealed_nonce)) {
      return false;
    }
    if (
      p.settings_secret_paths !== undefined &&
      !validateArray(p.settings_secret_paths, (path): path is unknown[] =>
        Array.isArray(path) && path.length > 0 && path.every((part) => isString(part) || isNumber(part)))
    ) {
      return false;
    }
  }

  // Validate data has required array properties
  const data = p.data;
  if (data === null || typeof data !== "object") {
    return false;
  }

  const d = data as Record<string, unknown>;

  // l4ProxyHosts is optional for backward compatibility with older master instances
  if (d.l4ProxyHosts !== undefined && !validateArray(d.l4ProxyHosts, isL4ProxyHost)) {
    return false;
  }

  return (
    validateArray(d.certificates, isCertificate) &&
    validateArray(d.caCertificates, isCaCertificate) &&
    validateArray(d.issuedClientCertificates, isIssuedClientCertificate) &&
    validateArray(d.accessLists, isAccessList) &&
    validateArray(d.accessListEntries, isAccessListEntry) &&
    validateArray(d.proxyHosts, isProxyHost)
  );
}

/**
 * Slave mode, the request limit and the master's bearer token. Returns the
 * refusal, or null when the request may proceed.
 */
async function refuseUnauthorizedSyncRequest(request: NextRequest, limiter: RateLimiter): Promise<NextResponse | null> {
  const mode = await getInstanceMode();
  if (mode !== "slave") {
    return NextResponse.json({ error: "Instance is not configured as a slave" }, { status: 403 });
  }

  const clientIp = getClientIp(request.headers);
  const rateLimit = limiter.isRateLimited(clientIp);
  if (rateLimit.blocked) {
    const retryAfterSeconds = rateLimit.retryAfterMs ? Math.ceil(rateLimit.retryAfterMs / 1000) : 60;
    return NextResponse.json(
      { error: "Too many sync requests. Please retry later." },
      { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } }
    );
  }
  limiter.registerAttempt(clientIp);

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = await getSlaveMasterToken();

  if (!expected || !secureTokenCompare(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * This slave's public key, which the master seals the secrets in the sync
 * payload to, and a single-use nonce for that payload (see
 * src/lib/sync-crypto.ts). Authenticated like the sync; the master fetches
 * both before every sync. With `?challenge=` (masters that pin slave keys
 * send one), the reply also carries a rotation proof from each key derived
 * from SESSION_SECRET_PREVIOUS; a challenge that is not a usable X25519
 * public key gets 400 and no nonce.
 */
export async function GET(request: NextRequest) {
  const refusal = await refuseUnauthorizedSyncRequest(request, keyRateLimiter);
  if (refusal) return refusal;
  let body: SyncPublicKeyResponse;
  try {
    body = createSyncKeyResponse(request.nextUrl.searchParams.get(SYNC_KEY_CHALLENGE_PARAM));
  } catch (error) {
    if (!(error instanceof SyncSealError) || error.code !== "invalid_challenge") throw error;
    return NextResponse.json({ error: "Invalid sync key challenge" }, { status: 400 });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const refusal = await refuseUnauthorizedSyncRequest(request, syncRateLimiter);
  if (refusal) return refusal;

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
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isValidSyncPayload(payload)) {
    return NextResponse.json({ error: "Invalid sync payload structure" }, { status: 400 });
  }

  // Semantic validation of proxy host content
  for (const host of (payload as SyncPayload).data.proxyHosts) {
    const err = validateProxyHostContent(host as unknown as Record<string, unknown>);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // Semantic validation of L4 proxy host content (l4ProxyHosts is optional for
  // backward compatibility with older master instances)
  for (const host of (payload as SyncPayload).data.l4ProxyHosts ?? []) {
    const err = validateL4ProxyHostContent(host as unknown as Record<string, unknown>);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  try {
    // Backfill l4ProxyHosts for payloads from older master instances that don't include it
    const normalizedPayload: SyncPayload = {
      ...payload,
      data: {
        ...payload.data,
        l4ProxyHosts: payload.data.l4ProxyHosts ?? [],
      },
    };
    await applySyncPayload(normalizedPayload);
    await applyCaddyConfig();
    await setSlaveLastSync({ ok: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyncSealError) {
      // Nothing was written. A payload sealed to a previous key (this slave's
      // SESSION_SECRET changed after the master fetched the key) or with a
      // nonce this process no longer holds (it restarted, the nonce expired
      // or was used) gets 409: the master's next sync fetches both again.
      const retry = error.code === "key_mismatch" || error.code === "stale";
      const message = error.code === "key_mismatch"
        ? SYNC_SEALED_KEY_MISMATCH_ERROR
        : error.code === "stale" ? SYNC_SEALED_STALE_ERROR : SYNC_SEALED_OPEN_FAILED_ERROR;
      await setSlaveLastSync({ ok: false, error: message });
      return NextResponse.json({ error: message }, { status: retry ? 409 : 400 });
    }
    // This value is persisted and later serialized into the settings browser;
    // keep it operationally useful but independent of exception internals.
    await setSlaveLastSync({ ok: false, error: "Failed to apply synchronized configuration" });
    return NextResponse.json({ error: "Failed to apply sync payload" }, { status: 500 });
  }
}
