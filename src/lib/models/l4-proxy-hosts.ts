import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { l4ProxyHosts } from "../db/schema";
import { asc, desc, eq, count, like, or } from "drizzle-orm";

export type L4Protocol = "tcp" | "udp";
export type L4MatcherType = "none" | "tls_sni" | "http_host" | "proxy_protocol";
export type L4ProxyProtocolVersion = "v1" | "v2";

export type L4LoadBalancingPolicy = "random" | "round_robin" | "least_conn" | "ip_hash" | "first";

export type L4LoadBalancerActiveHealthCheck = {
  enabled: boolean;
  port: number | null;
  interval: string | null;
  timeout: string | null;
};

export type L4LoadBalancerPassiveHealthCheck = {
  enabled: boolean;
  failDuration: string | null;
  maxFails: number | null;
  unhealthyLatency: string | null;
};

export type L4LoadBalancerConfig = {
  enabled: boolean;
  policy: L4LoadBalancingPolicy;
  tryDuration: string | null;
  tryInterval: string | null;
  retries: number | null;
  activeHealthCheck: L4LoadBalancerActiveHealthCheck | null;
  passiveHealthCheck: L4LoadBalancerPassiveHealthCheck | null;
};

export type L4DnsResolverConfig = {
  enabled: boolean;
  resolvers: string[];
  fallbacks: string[];
  timeout: string | null;
};

export type L4UpstreamDnsResolutionConfig = {
  enabled: boolean | null;
  family: "ipv6" | "ipv4" | "both" | null;
};

type L4LoadBalancerActiveHealthCheckMeta = {
  enabled?: boolean;
  port?: number;
  interval?: string;
  timeout?: string;
};

type L4LoadBalancerPassiveHealthCheckMeta = {
  enabled?: boolean;
  fail_duration?: string;
  max_fails?: number;
  unhealthy_latency?: string;
};

type L4LoadBalancerMeta = {
  enabled?: boolean;
  policy?: string;
  try_duration?: string;
  try_interval?: string;
  retries?: number;
  active_health_check?: L4LoadBalancerActiveHealthCheckMeta;
  passive_health_check?: L4LoadBalancerPassiveHealthCheckMeta;
};

type L4DnsResolverMeta = {
  enabled?: boolean;
  resolvers?: string[];
  fallbacks?: string[];
  timeout?: string;
};

type L4UpstreamDnsResolutionMeta = {
  enabled?: boolean;
  family?: string;
};

export type L4GeoBlockConfig = {
  enabled: boolean;
  block_countries: string[];
  block_continents: string[];
  block_asns: number[];
  block_cidrs: string[];
  block_ips: string[];
  allow_countries: string[];
  allow_continents: string[];
  allow_asns: number[];
  allow_cidrs: string[];
  allow_ips: string[];
};

export type L4GeoBlockMode = "merge" | "override";

export type L4ProxyHostMeta = {
  load_balancer?: L4LoadBalancerMeta;
  dns_resolver?: L4DnsResolverMeta;
  upstream_dns_resolution?: L4UpstreamDnsResolutionMeta;
  geoblock?: L4GeoBlockConfig;
  geoblock_mode?: L4GeoBlockMode;
};

const VALID_L4_LB_POLICIES: L4LoadBalancingPolicy[] = ["random", "round_robin", "least_conn", "ip_hash", "first"];
const VALID_L4_UPSTREAM_DNS_FAMILIES: L4UpstreamDnsResolutionConfig["family"][] = ["ipv6", "ipv4", "both"];

export type L4ProxyHost = {
  id: number;
  name: string;
  protocol: L4Protocol;
  listen_address: string;
  upstreams: string[];
  matcher_type: L4MatcherType;
  matcher_value: string[];
  tls_termination: boolean;
  proxy_protocol_version: L4ProxyProtocolVersion | null;
  proxy_protocol_receive: boolean;
  enabled: boolean;
  meta: L4ProxyHostMeta | null;
  load_balancer: L4LoadBalancerConfig | null;
  dns_resolver: L4DnsResolverConfig | null;
  upstream_dns_resolution: L4UpstreamDnsResolutionConfig | null;
  geoblock: L4GeoBlockConfig | null;
  geoblock_mode: L4GeoBlockMode;
  created_at: string;
  updated_at: string;
};

export type L4ProxyHostInput = {
  name: string;
  protocol: L4Protocol;
  listen_address: string;
  upstreams: string[];
  matcher_type?: L4MatcherType;
  matcher_value?: string[];
  tls_termination?: boolean;
  proxy_protocol_version?: L4ProxyProtocolVersion | null;
  proxy_protocol_receive?: boolean;
  enabled?: boolean;
  meta?: L4ProxyHostMeta | null;
  load_balancer?: Partial<L4LoadBalancerConfig> | null;
  dns_resolver?: Partial<L4DnsResolverConfig> | null;
  upstream_dns_resolution?: Partial<L4UpstreamDnsResolutionConfig> | null;
  geoblock?: L4GeoBlockConfig | null;
  geoblock_mode?: L4GeoBlockMode;
};

const VALID_PROTOCOLS: L4Protocol[] = ["tcp", "udp"];
const VALID_MATCHER_TYPES: L4MatcherType[] = ["none", "tls_sni", "http_host", "proxy_protocol"];
const VALID_PROXY_PROTOCOL_VERSIONS: L4ProxyProtocolVersion[] = ["v1", "v2"];

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeMetaValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hydrateL4LoadBalancer(meta: L4LoadBalancerMeta | undefined): L4LoadBalancerConfig | null {
  if (!meta) return null;

  const enabled = Boolean(meta.enabled);
  const policy: L4LoadBalancingPolicy =
    meta.policy && VALID_L4_LB_POLICIES.includes(meta.policy as L4LoadBalancingPolicy)
      ? (meta.policy as L4LoadBalancingPolicy)
      : "random";

  const tryDuration = normalizeMetaValue(meta.try_duration ?? null);
  const tryInterval = normalizeMetaValue(meta.try_interval ?? null);
  const retries =
    typeof meta.retries === "number" && Number.isFinite(meta.retries) && meta.retries >= 0
      ? meta.retries
      : null;

  let activeHealthCheck: L4LoadBalancerActiveHealthCheck | null = null;
  if (meta.active_health_check) {
    activeHealthCheck = {
      enabled: Boolean(meta.active_health_check.enabled),
      port:
        typeof meta.active_health_check.port === "number" &&
        Number.isFinite(meta.active_health_check.port) &&
        meta.active_health_check.port > 0
          ? meta.active_health_check.port
          : null,
      interval: normalizeMetaValue(meta.active_health_check.interval ?? null),
      timeout: normalizeMetaValue(meta.active_health_check.timeout ?? null),
    };
  }

  let passiveHealthCheck: L4LoadBalancerPassiveHealthCheck | null = null;
  if (meta.passive_health_check) {
    passiveHealthCheck = {
      enabled: Boolean(meta.passive_health_check.enabled),
      failDuration: normalizeMetaValue(meta.passive_health_check.fail_duration ?? null),
      maxFails:
        typeof meta.passive_health_check.max_fails === "number" &&
        Number.isFinite(meta.passive_health_check.max_fails) &&
        meta.passive_health_check.max_fails >= 0
          ? meta.passive_health_check.max_fails
          : null,
      unhealthyLatency: normalizeMetaValue(meta.passive_health_check.unhealthy_latency ?? null),
    };
  }

  return {
    enabled,
    policy,
    tryDuration,
    tryInterval,
    retries,
    activeHealthCheck,
    passiveHealthCheck,
  };
}

function dehydrateL4LoadBalancer(config: Partial<L4LoadBalancerConfig> | null): L4LoadBalancerMeta | undefined {
  if (!config) return undefined;

  const meta: L4LoadBalancerMeta = {
    enabled: Boolean(config.enabled),
  };

  if (config.policy) {
    meta.policy = config.policy;
  }
  if (config.tryDuration) {
    meta.try_duration = config.tryDuration;
  }
  if (config.tryInterval) {
    meta.try_interval = config.tryInterval;
  }
  if (config.retries !== undefined && config.retries !== null) {
    meta.retries = config.retries;
  }

  if (config.activeHealthCheck) {
    const ahc: L4LoadBalancerActiveHealthCheckMeta = {
      enabled: config.activeHealthCheck.enabled,
    };
    if (config.activeHealthCheck.port !== null && config.activeHealthCheck.port !== undefined) {
      ahc.port = config.activeHealthCheck.port;
    }
    if (config.activeHealthCheck.interval) {
      ahc.interval = config.activeHealthCheck.interval;
    }
    if (config.activeHealthCheck.timeout) {
      ahc.timeout = config.activeHealthCheck.timeout;
    }
    meta.active_health_check = ahc;
  }

  if (config.passiveHealthCheck) {
    const phc: L4LoadBalancerPassiveHealthCheckMeta = {
      enabled: config.passiveHealthCheck.enabled,
    };
    if (config.passiveHealthCheck.failDuration) {
      phc.fail_duration = config.passiveHealthCheck.failDuration;
    }
    if (config.passiveHealthCheck.maxFails !== null && config.passiveHealthCheck.maxFails !== undefined) {
      phc.max_fails = config.passiveHealthCheck.maxFails;
    }
    if (config.passiveHealthCheck.unhealthyLatency) {
      phc.unhealthy_latency = config.passiveHealthCheck.unhealthyLatency;
    }
    meta.passive_health_check = phc;
  }

  return meta;
}

function hydrateL4DnsResolver(meta: L4DnsResolverMeta | undefined): L4DnsResolverConfig | null {
  if (!meta) return null;

  const enabled = Boolean(meta.enabled);

  const resolvers = Array.isArray(meta.resolvers)
    ? meta.resolvers.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : [];

  const fallbacks = Array.isArray(meta.fallbacks)
    ? meta.fallbacks.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : [];

  const timeout = normalizeMetaValue(meta.timeout ?? null);

  return {
    enabled,
    resolvers,
    fallbacks,
    timeout,
  };
}

function dehydrateL4DnsResolver(config: Partial<L4DnsResolverConfig> | null): L4DnsResolverMeta | undefined {
  if (!config) return undefined;

  const meta: L4DnsResolverMeta = {
    enabled: Boolean(config.enabled),
  };

  if (config.resolvers && config.resolvers.length > 0) {
    meta.resolvers = [...config.resolvers];
  }
  if (config.fallbacks && config.fallbacks.length > 0) {
    meta.fallbacks = [...config.fallbacks];
  }
  if (config.timeout) {
    meta.timeout = config.timeout;
  }

  return meta;
}

function hydrateL4UpstreamDnsResolution(meta: L4UpstreamDnsResolutionMeta | undefined): L4UpstreamDnsResolutionConfig | null {
  if (!meta) return null;

  const enabled = meta.enabled === undefined ? null : Boolean(meta.enabled);
  const family =
    meta.family && VALID_L4_UPSTREAM_DNS_FAMILIES.includes(meta.family as L4UpstreamDnsResolutionConfig["family"])
      ? (meta.family as L4UpstreamDnsResolutionConfig["family"])
      : null;

  return {
    enabled,
    family,
  };
}

function dehydrateL4UpstreamDnsResolution(
  config: Partial<L4UpstreamDnsResolutionConfig> | null
): L4UpstreamDnsResolutionMeta | undefined {
  if (!config) return undefined;

  const meta: L4UpstreamDnsResolutionMeta = {};
  if (config.enabled !== null && config.enabled !== undefined) {
    meta.enabled = Boolean(config.enabled);
  }
  if (config.family && VALID_L4_UPSTREAM_DNS_FAMILIES.includes(config.family)) {
    meta.family = config.family;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

type L4ProxyHostRow = typeof l4ProxyHosts.$inferSelect;

function parseL4ProxyHost(row: L4ProxyHostRow): L4ProxyHost {
  const meta = safeJsonParse<L4ProxyHostMeta>(row.meta, {});
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as L4Protocol,
    listen_address: row.listenAddress,
    upstreams: safeJsonParse<string[]>(row.upstreams, []),
    matcher_type: (row.matcherType as L4MatcherType) || "none",
    matcher_value: safeJsonParse<string[]>(row.matcherValue, []),
    tls_termination: row.tlsTermination,
    proxy_protocol_version: row.proxyProtocolVersion as L4ProxyProtocolVersion | null,
    proxy_protocol_receive: row.proxyProtocolReceive,
    enabled: row.enabled,
    meta: Object.keys(meta).length > 0 ? meta : null,
    load_balancer: hydrateL4LoadBalancer(meta.load_balancer),
    dns_resolver: hydrateL4DnsResolver(meta.dns_resolver),
    upstream_dns_resolution: hydrateL4UpstreamDnsResolution(meta.upstream_dns_resolution),
    geoblock: meta.geoblock?.enabled ? meta.geoblock : null,
    geoblock_mode: meta.geoblock_mode ?? "merge",
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!,
  };
}

function validateL4Input(input: L4ProxyHostInput | Partial<L4ProxyHostInput>, isCreate: boolean) {
  if (isCreate) {
    if (!input.name?.trim()) {
      throw new Error("Name is required");
    }
    if (!input.protocol || !VALID_PROTOCOLS.includes(input.protocol)) {
      throw new Error("Protocol must be 'tcp' or 'udp'");
    }
    if (!input.listen_address?.trim()) {
      throw new Error("Listen address is required");
    }
    if (!input.upstreams || input.upstreams.length === 0) {
      throw new Error("At least one upstream must be specified");
    }
  }

  if (input.listen_address !== undefined) {
    const addr = input.listen_address.trim();
    // Must be :PORT or HOST:PORT
    const portMatch = addr.match(/:(\d+)$/);
    if (!portMatch) {
      throw new Error("Listen address must be in format ':PORT' or 'HOST:PORT'");
    }
    const port = parseInt(portMatch[1], 10);
    if (port < 1 || port > 65535) {
      throw new Error("Port must be between 1 and 65535");
    }
  }

  if (input.protocol !== undefined && !VALID_PROTOCOLS.includes(input.protocol)) {
    throw new Error("Protocol must be 'tcp' or 'udp'");
  }

  if (input.matcher_type !== undefined && !VALID_MATCHER_TYPES.includes(input.matcher_type)) {
    throw new Error(`Matcher type must be one of: ${VALID_MATCHER_TYPES.join(", ")}`);
  }

  if (input.matcher_type === "tls_sni" || input.matcher_type === "http_host") {
    if (!input.matcher_value || input.matcher_value.length === 0) {
      throw new Error("Matcher value is required for TLS SNI and HTTP Host matchers");
    }
  }

  if (input.tls_termination && input.protocol === "udp") {
    throw new Error("TLS termination is only supported with TCP protocol");
  }

  if (input.proxy_protocol_version !== undefined && input.proxy_protocol_version !== null) {
    if (!VALID_PROXY_PROTOCOL_VERSIONS.includes(input.proxy_protocol_version)) {
      throw new Error("Proxy protocol version must be 'v1' or 'v2'");
    }
  }

  if (input.upstreams) {
    for (const upstream of input.upstreams) {
      if (!upstream.includes(":")) {
        throw new Error(`Upstream '${upstream}' must be in 'host:port' format`);
      }
    }
  }
}

export async function listL4ProxyHosts(): Promise<L4ProxyHost[]> {
  const hosts = await db.select().from(l4ProxyHosts).orderBy(desc(l4ProxyHosts.createdAt));
  return hosts.map(parseL4ProxyHost);
}

export async function countL4ProxyHosts(search?: string): Promise<number> {
  const where = search
    ? or(
        like(l4ProxyHosts.name, `%${search}%`),
        like(l4ProxyHosts.listenAddress, `%${search}%`),
        like(l4ProxyHosts.upstreams, `%${search}%`)
      )
    : undefined;
  const [row] = await db.select({ value: count() }).from(l4ProxyHosts).where(where);
  return row?.value ?? 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L4_SORT_COLUMNS: Record<string, any> = {
  name: l4ProxyHosts.name,
  protocol: l4ProxyHosts.protocol,
  listen_address: l4ProxyHosts.listenAddress,
  upstreams: l4ProxyHosts.upstreams,
  enabled: l4ProxyHosts.enabled,
  created_at: l4ProxyHosts.createdAt,
};

export async function listL4ProxyHostsPaginated(
  limit: number,
  offset: number,
  search?: string,
  sortBy?: string,
  sortDir?: "asc" | "desc"
): Promise<L4ProxyHost[]> {
  const where = search
    ? or(
        like(l4ProxyHosts.name, `%${search}%`),
        like(l4ProxyHosts.listenAddress, `%${search}%`),
        like(l4ProxyHosts.upstreams, `%${search}%`)
      )
    : undefined;
  const col = (sortBy && L4_SORT_COLUMNS[sortBy]) || l4ProxyHosts.createdAt;
  const dir = sortDir === "asc" ? asc : desc;
  const hosts = await db
    .select()
    .from(l4ProxyHosts)
    .where(where)
    .orderBy(dir(col))
    .limit(limit)
    .offset(offset);
  return hosts.map(parseL4ProxyHost);
}

export async function createL4ProxyHost(input: L4ProxyHostInput, actorUserId: number) {
  validateL4Input(input, true);

  const now = nowIso();
  const [record] = await db
    .insert(l4ProxyHosts)
    .values({
      name: input.name.trim(),
      protocol: input.protocol,
      listenAddress: input.listen_address.trim(),
      upstreams: JSON.stringify(Array.from(new Set(input.upstreams.map((u) => u.trim())))),
      matcherType: input.matcher_type ?? "none",
      matcherValue: input.matcher_value ? JSON.stringify(input.matcher_value.map((v) => v.trim()).filter(Boolean)) : null,
      tlsTermination: input.tls_termination ?? false,
      proxyProtocolVersion: input.proxy_protocol_version ?? null,
      proxyProtocolReceive: input.proxy_protocol_receive ?? false,
      ownerUserId: actorUserId,
      meta: (() => {
        const meta: L4ProxyHostMeta = { ...(input.meta ?? {}) };
        if (input.load_balancer) meta.load_balancer = dehydrateL4LoadBalancer(input.load_balancer);
        if (input.dns_resolver) meta.dns_resolver = dehydrateL4DnsResolver(input.dns_resolver);
        if (input.upstream_dns_resolution) meta.upstream_dns_resolution = dehydrateL4UpstreamDnsResolution(input.upstream_dns_resolution);
        if (input.geoblock) meta.geoblock = input.geoblock;
        if (input.geoblock_mode && input.geoblock_mode !== "merge") meta.geoblock_mode = input.geoblock_mode;
        return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
      })(),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create L4 proxy host");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "l4_proxy_host",
    entityId: record.id,
    summary: `Created L4 proxy host ${input.name}`,
    data: input,
  });

  await applyCaddyConfig();
  return (await getL4ProxyHost(record.id))!;
}

export async function getL4ProxyHost(id: number): Promise<L4ProxyHost | null> {
  const host = await db.query.l4ProxyHosts.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });
  return host ? parseL4ProxyHost(host) : null;
}

export async function updateL4ProxyHost(id: number, input: Partial<L4ProxyHostInput>, actorUserId: number) {
  const existing = await getL4ProxyHost(id);
  if (!existing) {
    throw new Error("L4 proxy host not found");
  }

  // For validation, merge with existing to check cross-field constraints
  const merged = {
    protocol: input.protocol ?? existing.protocol,
    tls_termination: input.tls_termination ?? existing.tls_termination,
    matcher_type: input.matcher_type ?? existing.matcher_type,
    matcher_value: input.matcher_value ?? existing.matcher_value,
  };
  if (merged.tls_termination && merged.protocol === "udp") {
    throw new Error("TLS termination is only supported with TCP protocol");
  }
  if ((merged.matcher_type === "tls_sni" || merged.matcher_type === "http_host") && merged.matcher_value.length === 0) {
    throw new Error("Matcher value is required for TLS SNI and HTTP Host matchers");
  }

  validateL4Input(input, false);

  const now = nowIso();
  await db
    .update(l4ProxyHosts)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
      ...(input.listen_address !== undefined ? { listenAddress: input.listen_address.trim() } : {}),
      ...(input.upstreams !== undefined
        ? { upstreams: JSON.stringify(Array.from(new Set(input.upstreams.map((u) => u.trim())))) }
        : {}),
      ...(input.matcher_type !== undefined ? { matcherType: input.matcher_type } : {}),
      ...(input.matcher_value !== undefined
        ? { matcherValue: JSON.stringify(input.matcher_value.map((v) => v.trim()).filter(Boolean)) }
        : {}),
      ...(input.tls_termination !== undefined ? { tlsTermination: input.tls_termination } : {}),
      ...(input.proxy_protocol_version !== undefined ? { proxyProtocolVersion: input.proxy_protocol_version } : {}),
      ...(input.proxy_protocol_receive !== undefined ? { proxyProtocolReceive: input.proxy_protocol_receive } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(() => {
        const hasMetaChanges =
          input.meta !== undefined ||
          input.load_balancer !== undefined ||
          input.dns_resolver !== undefined ||
          input.upstream_dns_resolution !== undefined;
        if (!hasMetaChanges) return {};

        // Start from existing meta
        const existingMeta: L4ProxyHostMeta = {
          ...(existing.load_balancer ? { load_balancer: dehydrateL4LoadBalancer(existing.load_balancer) } : {}),
          ...(existing.dns_resolver ? { dns_resolver: dehydrateL4DnsResolver(existing.dns_resolver) } : {}),
          ...(existing.upstream_dns_resolution ? { upstream_dns_resolution: dehydrateL4UpstreamDnsResolution(existing.upstream_dns_resolution) } : {}),
          ...(existing.geoblock ? { geoblock: existing.geoblock } : {}),
          ...(existing.geoblock_mode !== "merge" ? { geoblock_mode: existing.geoblock_mode } : {}),
        };

        // Apply direct meta override if provided
        const meta: L4ProxyHostMeta = input.meta !== undefined ? { ...(input.meta ?? {}) } : { ...existingMeta };

        // Apply structured field overrides
        if (input.load_balancer !== undefined) {
          const lb = dehydrateL4LoadBalancer(input.load_balancer);
          if (lb) {
            meta.load_balancer = lb;
          } else {
            delete meta.load_balancer;
          }
        }
        if (input.dns_resolver !== undefined) {
          const dr = dehydrateL4DnsResolver(input.dns_resolver);
          if (dr) {
            meta.dns_resolver = dr;
          } else {
            delete meta.dns_resolver;
          }
        }
        if (input.upstream_dns_resolution !== undefined) {
          const udr = dehydrateL4UpstreamDnsResolution(input.upstream_dns_resolution);
          if (udr) {
            meta.upstream_dns_resolution = udr;
          } else {
            delete meta.upstream_dns_resolution;
          }
        }
        if (input.geoblock !== undefined) {
          if (input.geoblock) {
            meta.geoblock = input.geoblock;
          } else {
            delete meta.geoblock;
          }
        }
        if (input.geoblock_mode !== undefined) {
          if (input.geoblock_mode !== "merge") {
            meta.geoblock_mode = input.geoblock_mode;
          } else {
            delete meta.geoblock_mode;
          }
        }

        return { meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null };
      })(),
      updatedAt: now,
    })
    .where(eq(l4ProxyHosts.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "l4_proxy_host",
    entityId: id,
    summary: `Updated L4 proxy host ${input.name ?? existing.name}`,
    data: input,
  });

  await applyCaddyConfig();
  return (await getL4ProxyHost(id))!;
}

export async function deleteL4ProxyHost(id: number, actorUserId: number) {
  const existing = await getL4ProxyHost(id);
  if (!existing) {
    throw new Error("L4 proxy host not found");
  }

  await db.delete(l4ProxyHosts).where(eq(l4ProxyHosts.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "l4_proxy_host",
    entityId: id,
    summary: `Deleted L4 proxy host ${existing.name}`,
  });
  await applyCaddyConfig();
}
