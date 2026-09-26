import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { resolveForwardAuthAudience, type ForwardAuthAudience } from "./models/forward-auth";

/**
 * Internal proof header injected by generated Caddy routes before they proxy a
 * forward-auth callback/verification request to CPM.  Forwarded host/protocol
 * headers alone are not trustworthy because the Next.js origin may be reachable
 * directly and clients can forge them there.
 */
export const FORWARD_AUTH_PROXY_PROOF_HEADER = "X-CPM-Forward-Auth-Proof";

/**
 * Proxy-host ID of the Caddy route that issued the subrequest.  Caddy chose the
 * route from the raw Host header, so CPM must authorize against that same
 * proxy host rather than re-deriving it from a hostname it parsed itself.
 */
export const FORWARD_AUTH_PROXY_HOST_ID_HEADER = "X-CPM-Proxy-Host-Id";

/**
 * Set by the verify endpoint on 401/403 responses: the portal's `rd` value for
 * the request being verified, already encoded for a query string.  The
 * generated Caddy route places it into the portal redirect it issues.
 */
export const FORWARD_AUTH_PORTAL_TARGET_HEADER = "X-CPM-Portal-Target";

/**
 * Host header syntax accepted from Caddy: LDH labels (optionally with a
 * trailing dot) or a bracketed IPv6 literal, plus an optional port.  Anything
 * else — percent-encoding, non-ASCII, IPv4 shorthands — could be normalized by
 * the URL parser into a different hostname than the one Caddy matched.
 */
const FORWARDED_HOST_RE =
  /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

const PROOF_CONTEXT = "cpm-forward-auth-proxy-proof:v1";

/**
 * Derive a purpose-specific key instead of placing SESSION_SECRET itself in the
 * generated Caddy configuration.  Administrators who can read Caddy's config
 * are already trusted with the forward-auth control plane.
 */
export function getForwardAuthProxyProof(): string {
  return createHmac("sha256", config.sessionSecret)
    .update(PROOF_CONTEXT)
    .digest("hex");
}

function hasValidProxyProof(headers: Headers): boolean {
  const supplied = headers.get(FORWARD_AUTH_PROXY_PROOF_HEADER);
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;

  const expected = Buffer.from(getForwardAuthProxyProof(), "hex");
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Return the exact, normalized external origin vouched for by Caddy.  Scheme,
 * hostname, and non-default port are all part of URL.origin.  No Host fallback
 * is allowed: a direct request must never be able to manufacture an audience.
 */
export function getTrustedForwardAuthOrigin(headers: Headers): string | null {
  if (!hasValidProxyProof(headers)) return null;

  const forwardedProto = headers.get("x-forwarded-proto")?.trim().toLowerCase();
  const forwardedHost = headers.get("x-forwarded-host")?.trim();
  if (
    (forwardedProto !== "http" && forwardedProto !== "https") ||
    !forwardedHost ||
    !FORWARDED_HOST_RE.test(forwardedHost)
  ) {
    return null;
  }

  try {
    const parsed = new URL(`${forwardedProto}://${forwardedHost}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    // The parsed hostname must be exactly what Caddy saw (case aside).
    const rawHostname = forwardedHost.startsWith("[")
      ? forwardedHost.slice(0, forwardedHost.indexOf("]") + 1)
      : forwardedHost.replace(/:\d+$/, "");
    if (parsed.hostname !== rawHostname.toLowerCase()) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Encode a value for a query string.  Everything encodeURIComponent escapes
 * stays escaped except "/", ":", "?" and "=", which are unambiguous inside a
 * query value and keep the portal URL readable.  "&", "#", "+" and "%" are
 * always escaped, so the value decodes back to exactly the input.
 */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%(?:2F|3A|3F|3D)/g, (escaped) =>
    decodeURIComponent(escaped)
  );
}

/**
 * The portal `rd` value (query-encoded) for the request Caddy is verifying:
 * the proof-checked forwarded origin plus X-Forwarded-Uri.  Null when the
 * request is not a well-formed Caddy subrequest; Caddy then falls back to a
 * target it escapes itself.
 */
export function getForwardAuthPortalTarget(headers: Headers): string | null {
  const origin = getTrustedForwardAuthOrigin(headers);
  if (!origin) return null;
  // Caddy sends the origin-form request URI, which is printable ASCII.
  const uri = headers.get("x-forwarded-uri") ?? "";
  if (!/^\/[\x21-\x7e]*$/.test(uri)) return null;
  return encodeQueryValue(`${origin}${uri}`);
}

/** The proxy-host ID pinned by the generated Caddy route, or null. */
export function getTrustedForwardAuthProxyHostId(headers: Headers): number | null {
  if (!hasValidProxyProof(headers)) return null;
  const raw = headers.get(FORWARD_AUTH_PROXY_HOST_ID_HEADER)?.trim() ?? "";
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Resolve the forward-auth audience for a Caddy subrequest.  Requires a valid
 * proxy proof, a well-formed forwarded origin, and that the origin resolves to
 * the same proxy host Caddy routed the request through.
 */
export async function resolveTrustedForwardAuthAudience(
  headers: Headers
): Promise<ForwardAuthAudience | null> {
  const origin = getTrustedForwardAuthOrigin(headers);
  const pinnedProxyHostId = getTrustedForwardAuthProxyHostId(headers);
  if (!origin || pinnedProxyHostId === null) return null;
  const audience = await resolveForwardAuthAudience(origin);
  if (!audience || audience.proxyHostId !== pinnedProxyHostId) return null;
  return audience;
}
