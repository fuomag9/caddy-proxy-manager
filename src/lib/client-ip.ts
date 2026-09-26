import { isIP } from "node:net";

/** Returned when no usable client address is available. */
export const UNKNOWN_CLIENT_IP = "unknown";

// Longest textual IPv6 address with an IPv4 tail and a short zone id, plus slack.
const MAX_IP_LENGTH = 64;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

let warnedInvalidHeader = false;

/** The eight 16-bit groups of an IPv6 address that isIP() accepted. */
function ipv6Groups(address: string): number[] {
  let value = address.replace(/%.*$/, "");
  // An IPv4 tail ("::ffff:192.0.2.1") stands for the last two groups.
  const v4Tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (v4Tail) {
    const [a, b, c, d] = v4Tail.slice(1).map(Number);
    value = `${value.slice(0, v4Tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = value.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array(8 - headGroups.length - tailGroups.length).fill("0");
  return [...headGroups, ...zeros, ...tailGroups].map((group) => parseInt(group, 16));
}

/**
 * Parses one address from a forwarding header: accepts plain IPv4/IPv6,
 * "[v6]:port", "v4:port", and unwraps IPv4-mapped IPv6 ("::ffff:a.b.c.d").
 */
function parseIp(raw: string | undefined): string | null {
  let value = raw?.trim() ?? "";
  if (!value || value.length > MAX_IP_LENGTH) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) {
    value = bracketed[1];
  } else {
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
    if (v4WithPort) value = v4WithPort[1];
  }
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const groups = ipv6Groups(value);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return value.toLowerCase();
}

/**
 * Client address for per-IP rate limiting. The result is a validated IP
 * address or UNKNOWN_CLIENT_IP, so it is short and safe to use in a key.
 *
 * With TRUSTED_CLIENT_IP_HEADER set (e.g. "x-real-ip", "cf-connecting-ip"),
 * that header is read first. This is only sound when every route by which
 * requests reach CPM sets or overwrites the header; otherwise a client can
 * send any value and pick its own rate-limit key. For a CDN header such as
 * cf-connecting-ip, that means the origin accepts connections from the CDN's
 * addresses only. Caddy, CPM's own proxy hosts included, passes these headers
 * through unchanged, so leave the variable unset when Caddy is the proxy in
 * front of CPM. A request without a usable value falls back to
 * X-Forwarded-For below, since its sender could as well have sent any value.
 *
 * X-Forwarded-For: the rightmost entry, i.e. the address the nearest proxy
 * saw. That is the real client behind Caddy, which replaces X-Forwarded-For
 * for untrusted peers and appends the peer address for trusted ones (so behind
 * a trusted edge such as a CDN it is the edge address; use the header above
 * there). When clients reach the web port directly, Next.js only fills
 * X-Forwarded-For with the socket address if the request has none, so the
 * client controls it and the per-IP limit is best effort.
 */
export function getClientIp(headers: Headers): string {
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configured) {
    if (HEADER_NAME.test(configured)) {
      // Repeated headers arrive comma-joined; the last one was added nearest to CPM.
      const ip = parseIp(headers.get(configured)?.split(",").pop());
      if (ip) return ip;
    } else if (!warnedInvalidHeader) {
      warnedInvalidHeader = true;
      console.warn(`TRUSTED_CLIENT_IP_HEADER is not a valid header name: ${JSON.stringify(configured)}`);
    }
  }
  return parseIp(headers.get("x-forwarded-for")?.split(",").pop()) ?? UNKNOWN_CLIENT_IP;
}

/**
 * Rate-limit bucket for an address from getClientIp. IPv4 addresses are kept
 * whole. IPv6 addresses are reduced to their /64 prefix, since a client
 * usually holds at least a /64 and can send each request from a new address
 * in it.
 */
export function ipRateLimitBucket(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const prefix = ipv6Groups(ip).slice(0, 4).map((group) => group.toString(16));
  return `${prefix.join(":")}::/64`;
}
