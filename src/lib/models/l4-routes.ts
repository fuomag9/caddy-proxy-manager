import db, { nowIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { l4Routes } from "../db/schema";
import { desc, eq, count, like, or, ne, and } from "drizzle-orm";
import { getMetricsSettings } from "../settings";

// ── Matcher types ──

export type TlsMatcher = {
  tls: { sni?: string[]; alpn?: string[] };
};

export type IpMatcher = {
  remote_ip?: { ranges: string[] };
  local_ip?: { ranges: string[] };
};

export type ProtocolMatcher = {
  [key: string]: Record<string, unknown> | undefined;
  // keys: ssh, dns, http, rdp, postgres, openvpn, socks4, socks5, xmpp, wireguard, quic, proxy_protocol, regexp
};

export type L4Matcher = TlsMatcher | IpMatcher | ProtocolMatcher;

// ── Upstream types ──

export type L4UpstreamTls = {
  insecure_skip_verify?: boolean;
  server_name?: string;
};

export type L4Upstream = {
  dial: string[];
  tls?: L4UpstreamTls;
};

// ── Meta types ──

export type L4LoadBalancingPolicy = "random" | "round_robin" | "least_conn" | "ip_hash" | "first";

export type L4HealthCheck = {
  interval?: string;
  timeout?: string;
  port?: number;
};

export type L4ThrottleConfig = {
  read_bytes_per_second?: number;
  write_bytes_per_second?: number;
};

export type L4IpBlockOverride = {
  mode: "inherit" | "override" | "disabled";
  block_cidrs?: string[];
  allow_cidrs?: string[];
};

export type L4RouteMeta = {
  load_balancing?: {
    policy?: L4LoadBalancingPolicy;
  };
  health_check?: L4HealthCheck;
  throttle?: L4ThrottleConfig;
  ip_block?: L4IpBlockOverride;
};

// ── Handler type ──

export type L4HandlerType = "proxy" | "echo" | "close" | "socks5";

// ── Output & Input types ──

export type L4Route = {
  id: number;
  name: string;
  listen_addresses: string[];
  matchers: L4Matcher[] | null;
  handler_type: L4HandlerType;
  upstreams: L4Upstream[] | null;
  tls_termination: boolean;
  certificate_id: number | null;
  proxy_protocol: string | null;
  matching_timeout: string | null;
  enabled: boolean;
  meta: L4RouteMeta | null;
  owner_user_id: number | null;
  created_at: string;
  updated_at: string;
};

export type L4RouteInput = {
  name: string;
  listen_addresses: string[];
  matchers?: L4Matcher[] | null;
  handler_type?: L4HandlerType;
  upstreams?: L4Upstream[] | null;
  tls_termination?: boolean;
  certificate_id?: number | null;
  proxy_protocol?: string | null;
  matching_timeout?: string | null;
  enabled?: boolean;
  meta?: L4RouteMeta | null;
};

// ── Parsing helpers ──

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type L4RouteRow = typeof l4Routes.$inferSelect;

function parseL4Route(row: L4RouteRow): L4Route {
  return {
    id: row.id,
    name: row.name,
    listen_addresses: parseJson<string[]>(row.listenAddresses, []).map(normalizeListenAddress),
    matchers: parseJson<L4Matcher[] | null>(row.matchers, null),
    handler_type: (row.handlerType ?? "proxy") as L4HandlerType,
    upstreams: parseJson<L4Upstream[] | null>(row.upstreams, null),
    tls_termination: !!row.tlsTermination,
    certificate_id: row.certificateId ?? null,
    proxy_protocol: row.proxyProtocol ?? null,
    matching_timeout: row.matchingTimeout ?? null,
    enabled: !!row.enabled,
    meta: parseJson<L4RouteMeta | null>(row.meta, null),
    owner_user_id: row.ownerUserId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ── Listen address normalization ──

/**
 * Normalize a listen address: strip stray colons after the network prefix.
 * e.g. "tcp:/:5000" → "tcp/:5000", "udp:/0.0.0.0:53" → "udp/0.0.0.0:53"
 */
function normalizeListenAddress(address: string): string {
  // Replace "network:/" with "network/" and "network:/host" with "network/host"
  return address.replace(/^([a-zA-Z0-9]+):\//, "$1/");
}

function parseListenAddress(address: string): { protocol: "tcp" | "udp" | null; host: string; port: number } | null {
  const normalized = normalizeListenAddress(address.trim());
  if (!normalized) return null;

  const protocolMatch = normalized.match(/^(tcp|udp)\/(.+)$/i);
  const protocol = protocolMatch ? protocolMatch[1].toLowerCase() as "tcp" | "udp" : null;
  const endpoint = protocolMatch ? protocolMatch[2] : normalized;

  if (endpoint.includes("/")) {
    return null;
  }

  let host = "";
  let portText = "";

  if (endpoint.startsWith(":")) {
    portText = endpoint.slice(1);
  } else if (endpoint.startsWith("[")) {
    const closingBracket = endpoint.indexOf("]");
    if (closingBracket <= 0 || endpoint.slice(closingBracket + 1, closingBracket + 2) !== ":") {
      return null;
    }
    host = endpoint.slice(0, closingBracket + 1);
    portText = endpoint.slice(closingBracket + 2);
  } else {
    const lastColon = endpoint.lastIndexOf(":");
    if (lastColon <= 0) {
      return null;
    }
    host = endpoint.slice(0, lastColon);
    portText = endpoint.slice(lastColon + 1);
  }

  if (!/^\d+$/.test(portText)) {
    return null;
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return { protocol, host, port };
}

function normalizeListenAddresses(addresses: string[]): string[] {
  return addresses.map((address) => normalizeListenAddress(address.trim()));
}

export function validateL4ListenAddressFormat(address: string): string | null {
  if (!address.trim()) {
    return "Listen address cannot be empty";
  }

  if (!parseListenAddress(address)) {
    return `Invalid listen address "${address}". Expected [protocol/][host]:port, for example :25, tcp/:587, or udp/:5060`;
  }

  return null;
}

// ── Port conflict validation ──

/** Extract numeric port from a listen address like ":25", "tcp/:587", "udp/0.0.0.0:5060" */
function extractPort(address: string): number | null {
  const match = address.match(/:(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

const RESERVED_PORTS = new Set([80, 443, 2019]);

export async function validateL4ListenAddresses(
  addresses: string[],
  excludeRouteId?: number
): Promise<string | null> {
  const normalizedAddresses = normalizeListenAddresses(addresses);

  for (const address of normalizedAddresses) {
    const formatError = validateL4ListenAddressFormat(address);
    if (formatError) {
      return formatError;
    }
  }

  const ports = normalizedAddresses.map(extractPort).filter((p): p is number => p !== null);

  // Check metrics port
  const metricsSettings = await getMetricsSettings();
  const metricsPort = metricsSettings?.port ?? 9090;
  const reserved = new Set([...RESERVED_PORTS, metricsPort]);

  for (const port of ports) {
    if (reserved.has(port)) {
      const portLabel =
        port === 80 || port === 443 ? "HTTP/HTTPS" :
        port === 2019 ? "Caddy Admin API" :
        port === metricsPort ? "Metrics" : "reserved";
      return `Port ${port} conflicts with ${portLabel}`;
    }
  }

  // Check for conflicts with other L4 routes that have no matchers (catch-all)
  const existingRoutes = await db.select().from(l4Routes);
  for (const row of existingRoutes) {
    if (excludeRouteId && row.id === excludeRouteId) continue;
    if (!row.enabled) continue;

    const existingAddresses = normalizeListenAddresses(parseJson<string[]>(row.listenAddresses, []));
    const existingPorts = existingAddresses.map(extractPort).filter((p): p is number => p !== null);
    const existingMatchers = parseJson<L4Matcher[] | null>(row.matchers, null);
    const newMatchers = addresses.length > 0; // We're checking the new route's addresses

    const overlappingPorts = ports.filter((p) => existingPorts.includes(p));
    if (overlappingPorts.length > 0) {
      // Both routes on the same port with no matchers = guaranteed conflict
      const bothCatchAll = !existingMatchers || existingMatchers.length === 0;
      if (bothCatchAll) {
        return `Port ${overlappingPorts[0]} conflicts with L4 route "${row.name}" (both catch-all without matchers)`;
      }
    }
  }

  return null;
}

// ── CRUD ──

export async function listL4Routes(): Promise<L4Route[]> {
  const rows = await db.select().from(l4Routes).orderBy(desc(l4Routes.createdAt));
  return rows.map(parseL4Route);
}

export async function countL4Routes(search?: string): Promise<number> {
  const where = search
    ? or(
        like(l4Routes.name, `%${search}%`),
        like(l4Routes.listenAddresses, `%${search}%`),
        like(l4Routes.upstreams, `%${search}%`)
      )
    : undefined;
  const [row] = await db.select({ value: count() }).from(l4Routes).where(where);
  return row?.value ?? 0;
}

export async function listL4RoutesPaginated(limit: number, offset: number, search?: string): Promise<L4Route[]> {
  const where = search
    ? or(
        like(l4Routes.name, `%${search}%`),
        like(l4Routes.listenAddresses, `%${search}%`),
        like(l4Routes.upstreams, `%${search}%`)
      )
    : undefined;
  const rows = await db
    .select()
    .from(l4Routes)
    .where(where)
    .orderBy(desc(l4Routes.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(parseL4Route);
}

export async function getL4Route(id: number): Promise<L4Route | null> {
  const row = await db.query.l4Routes.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });
  return row ? parseL4Route(row) : null;
}

export async function createL4Route(input: L4RouteInput, actorUserId: number) {
  if (!input.listen_addresses || input.listen_addresses.length === 0) {
    throw new Error("At least one listen address must be specified");
  }

  const handlerType = input.handler_type ?? "proxy";
  if (handlerType === "proxy" && (!input.upstreams || input.upstreams.length === 0)) {
    throw new Error("At least one upstream must be specified for proxy handler");
  }

  const normalizedListenAddresses = normalizeListenAddresses(input.listen_addresses);

  // Proxy protocol is not compatible with UDP
  if (input.proxy_protocol && normalizedListenAddresses.some((a) => a.startsWith("udp/"))) {
    throw new Error("Proxy Protocol is not compatible with UDP");
  }

  // Port conflict validation
  const portError = await validateL4ListenAddresses(normalizedListenAddresses);
  if (portError) {
    throw new Error(portError);
  }

  const now = nowIso();
  const [record] = await db
    .insert(l4Routes)
    .values({
      name: input.name.trim(),
      listenAddresses: JSON.stringify(normalizedListenAddresses),
      matchers: input.matchers ? JSON.stringify(input.matchers) : null,
      handlerType: handlerType,
      upstreams: input.upstreams ? JSON.stringify(input.upstreams) : null,
      tlsTermination: input.tls_termination ?? false,
      certificateId: input.certificate_id ?? null,
      proxyProtocol: input.proxy_protocol ?? null,
      matchingTimeout: input.matching_timeout ?? null,
      enabled: input.enabled ?? true,
      meta: input.meta ? JSON.stringify(input.meta) : null,
      ownerUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create L4 route");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "l4_route",
    entityId: record.id,
    summary: `Created L4 route ${input.name}`,
    data: input,
  });

  await applyCaddyConfig();
  return (await getL4Route(record.id))!;
}

export async function updateL4Route(id: number, input: Partial<L4RouteInput>, actorUserId: number) {
  const existing = await getL4Route(id);
  if (!existing) {
    throw new Error("L4 route not found");
  }

  // Port conflict validation
  const addressesToCheck = normalizeListenAddresses(input.listen_addresses ?? existing.listen_addresses);
  const portError = await validateL4ListenAddresses(addressesToCheck, id);
  if (portError) {
    throw new Error(portError);
  }

  // Proxy protocol is not compatible with UDP
  const effectiveProxyProtocol = input.proxy_protocol !== undefined ? input.proxy_protocol : existing.proxy_protocol;
  if (effectiveProxyProtocol && addressesToCheck.some((a) => a.startsWith("udp/"))) {
    throw new Error("Proxy Protocol is not compatible with UDP");
  }

  const now = nowIso();
  await db
    .update(l4Routes)
    .set({
      name: input.name ?? existing.name,
      listenAddresses: input.listen_addresses
        ? JSON.stringify(normalizeListenAddresses(input.listen_addresses))
        : JSON.stringify(existing.listen_addresses),
      matchers: input.matchers !== undefined
        ? (input.matchers ? JSON.stringify(input.matchers) : null)
        : (existing.matchers ? JSON.stringify(existing.matchers) : null),
      handlerType: input.handler_type ?? existing.handler_type,
      upstreams: input.upstreams !== undefined
        ? (input.upstreams ? JSON.stringify(input.upstreams) : null)
        : (existing.upstreams ? JSON.stringify(existing.upstreams) : null),
      tlsTermination: input.tls_termination ?? existing.tls_termination,
      certificateId: input.certificate_id !== undefined ? input.certificate_id : existing.certificate_id,
      proxyProtocol: input.proxy_protocol !== undefined ? input.proxy_protocol : existing.proxy_protocol,
      matchingTimeout: input.matching_timeout !== undefined ? input.matching_timeout : existing.matching_timeout,
      enabled: input.enabled ?? existing.enabled,
      meta: input.meta !== undefined
        ? (input.meta ? JSON.stringify(input.meta) : null)
        : (existing.meta ? JSON.stringify(existing.meta) : null),
      updatedAt: now,
    })
    .where(eq(l4Routes.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "l4_route",
    entityId: id,
    summary: `Updated L4 route ${input.name ?? existing.name}`,
    data: input,
  });

  await applyCaddyConfig();
  return (await getL4Route(id))!;
}

export async function deleteL4Route(id: number, actorUserId: number) {
  const existing = await getL4Route(id);
  if (!existing) {
    throw new Error("L4 route not found");
  }

  await db.delete(l4Routes).where(eq(l4Routes.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "l4_route",
    entityId: id,
    summary: `Deleted L4 route ${existing.name}`,
  });
  await applyCaddyConfig();
}

export async function toggleL4Route(id: number, enabled: boolean, actorUserId: number) {
  const existing = await getL4Route(id);
  if (!existing) {
    throw new Error("L4 route not found");
  }

  const now = nowIso();
  await db
    .update(l4Routes)
    .set({ enabled, updatedAt: now })
    .where(eq(l4Routes.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "l4_route",
    entityId: id,
    summary: `${enabled ? "Enabled" : "Disabled"} L4 route ${existing.name}`,
  });
  await applyCaddyConfig();
}
