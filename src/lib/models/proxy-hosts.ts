import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { proxyHosts } from "../db/schema";
import { desc, eq } from "drizzle-orm";

const DEFAULT_AUTHENTIK_HEADERS = [
  "X-Authentik-Username",
  "X-Authentik-Groups",
  "X-Authentik-Entitlements",
  "X-Authentik-Email",
  "X-Authentik-Name",
  "X-Authentik-Uid",
  "X-Authentik-Jwt",
  "X-Authentik-Meta-Jwks",
  "X-Authentik-Meta-Outpost",
  "X-Authentik-Meta-Provider",
  "X-Authentik-Meta-App",
  "X-Authentik-Meta-Version"
];

const DEFAULT_AUTHENTIK_TRUSTED_PROXIES = ["private_ranges"];

// Load Balancer Types
export type LoadBalancingPolicy = "random" | "round_robin" | "least_conn" | "ip_hash" | "first" | "header" | "cookie" | "uri_hash";

export type LoadBalancerActiveHealthCheck = {
  enabled: boolean;
  uri: string | null;
  port: number | null;
  interval: string | null;
  timeout: string | null;
  status: number | null;
  body: string | null;
};

export type LoadBalancerPassiveHealthCheck = {
  enabled: boolean;
  failDuration: string | null;
  maxFails: number | null;
  unhealthyStatus: number[] | null;
  unhealthyLatency: string | null;
};

export type LoadBalancerConfig = {
  enabled: boolean;
  policy: LoadBalancingPolicy;
  policyHeaderField: string | null;
  policyCookieName: string | null;
  policyCookieSecret: string | null;
  tryDuration: string | null;
  tryInterval: string | null;
  retries: number | null;
  activeHealthCheck: LoadBalancerActiveHealthCheck | null;
  passiveHealthCheck: LoadBalancerPassiveHealthCheck | null;
};

export type LoadBalancerInput = {
  enabled?: boolean;
  policy?: LoadBalancingPolicy;
  policyHeaderField?: string | null;
  policyCookieName?: string | null;
  policyCookieSecret?: string | null;
  tryDuration?: string | null;
  tryInterval?: string | null;
  retries?: number | null;
  activeHealthCheck?: {
    enabled?: boolean;
    uri?: string | null;
    port?: number | null;
    interval?: string | null;
    timeout?: string | null;
    status?: number | null;
    body?: string | null;
  } | null;
  passiveHealthCheck?: {
    enabled?: boolean;
    failDuration?: string | null;
    maxFails?: number | null;
    unhealthyStatus?: number[] | null;
    unhealthyLatency?: string | null;
  } | null;
};

type LoadBalancerActiveHealthCheckMeta = {
  enabled?: boolean;
  uri?: string;
  port?: number;
  interval?: string;
  timeout?: string;
  status?: number;
  body?: string;
};

type LoadBalancerPassiveHealthCheckMeta = {
  enabled?: boolean;
  fail_duration?: string;
  max_fails?: number;
  unhealthy_status?: number[];
  unhealthy_latency?: string;
};

type LoadBalancerMeta = {
  enabled?: boolean;
  policy?: string;
  policy_header_field?: string;
  policy_cookie_name?: string;
  policy_cookie_secret?: string;
  try_duration?: string;
  try_interval?: string;
  retries?: number;
  active_health_check?: LoadBalancerActiveHealthCheckMeta;
  passive_health_check?: LoadBalancerPassiveHealthCheckMeta;
};

// DNS Resolver Types
export type DnsResolverConfig = {
  enabled: boolean;
  resolvers: string[];
  fallbacks: string[] | null;
  timeout: string | null;
};

export type DnsResolverInput = {
  enabled?: boolean;
  resolvers?: string[];
  fallbacks?: string[] | null;
  timeout?: string | null;
};

type DnsResolverMeta = {
  enabled?: boolean;
  resolvers?: string[];
  fallbacks?: string[];
  timeout?: string;
};

export type ProxyHostAuthentikConfig = {
  enabled: boolean;
  outpostDomain: string | null;
  outpostUpstream: string | null;
  authEndpoint: string | null;
  copyHeaders: string[];
  trustedProxies: string[];
  setOutpostHostHeader: boolean;
  protectedPaths: string[] | null;
};

export type ProxyHostAuthentikInput = {
  enabled?: boolean;
  outpostDomain?: string | null;
  outpostUpstream?: string | null;
  authEndpoint?: string | null;
  copyHeaders?: string[] | null;
  trustedProxies?: string[] | null;
  setOutpostHostHeader?: boolean | null;
  protectedPaths?: string[] | null;
};

type ProxyHostAuthentikMeta = {
  enabled?: boolean;
  outpost_domain?: string;
  outpost_upstream?: string;
  auth_endpoint?: string;
  copy_headers?: string[];
  trusted_proxies?: string[];
  set_outpost_host_header?: boolean;
  protected_paths?: string[];
};

type ProxyHostMeta = {
  custom_reverse_proxy_json?: string;
  custom_pre_handlers_json?: string;
  authentik?: ProxyHostAuthentikMeta;
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
};

export type ProxyHost = {
  id: number;
  name: string;
  domains: string[];
  upstreams: string[];
  certificate_id: number | null;
  access_list_id: number | null;
  ssl_forced: boolean;
  hsts_enabled: boolean;
  hsts_subdomains: boolean;
  allow_websocket: boolean;
  preserve_host_header: boolean;
  skip_https_hostname_validation: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  custom_reverse_proxy_json: string | null;
  custom_pre_handlers_json: string | null;
  authentik: ProxyHostAuthentikConfig | null;
  load_balancer: LoadBalancerConfig | null;
  dns_resolver: DnsResolverConfig | null;
};

export type ProxyHostInput = {
  name: string;
  domains: string[];
  upstreams: string[];
  certificate_id?: number | null;
  access_list_id?: number | null;
  ssl_forced?: boolean;
  hsts_enabled?: boolean;
  hsts_subdomains?: boolean;
  allow_websocket?: boolean;
  preserve_host_header?: boolean;
  skip_https_hostname_validation?: boolean;
  enabled?: boolean;
  custom_reverse_proxy_json?: string | null;
  custom_pre_handlers_json?: string | null;
  authentik?: ProxyHostAuthentikInput | null;
  load_balancer?: LoadBalancerInput | null;
  dns_resolver?: DnsResolverInput | null;
};

type ProxyHostRow = typeof proxyHosts.$inferSelect;

function normalizeMetaValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAuthentikMeta(meta: ProxyHostAuthentikMeta | undefined): ProxyHostAuthentikMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const normalized: ProxyHostAuthentikMeta = {};

  if (meta.enabled !== undefined) {
    normalized.enabled = Boolean(meta.enabled);
  }

  const domain = normalizeMetaValue(meta.outpost_domain ?? null);
  if (domain) {
    normalized.outpost_domain = domain;
  }

  const upstream = normalizeMetaValue(meta.outpost_upstream ?? null);
  if (upstream) {
    normalized.outpost_upstream = upstream;
  }

  const authEndpoint = normalizeMetaValue(meta.auth_endpoint ?? null);
  if (authEndpoint) {
    normalized.auth_endpoint = authEndpoint;
  }

  if (Array.isArray(meta.copy_headers)) {
    const headers = meta.copy_headers.map((header) => header?.trim()).filter((header): header is string => Boolean(header));
    if (headers.length > 0) {
      normalized.copy_headers = headers;
    }
  }

  if (Array.isArray(meta.trusted_proxies)) {
    const proxies = meta.trusted_proxies.map((proxy) => proxy?.trim()).filter((proxy): proxy is string => Boolean(proxy));
    if (proxies.length > 0) {
      normalized.trusted_proxies = proxies;
    }
  }

  if (meta.set_outpost_host_header !== undefined) {
    normalized.set_outpost_host_header = Boolean(meta.set_outpost_host_header);
  }

  if (Array.isArray(meta.protected_paths)) {
    const paths = meta.protected_paths.map((path) => path?.trim()).filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      normalized.protected_paths = paths;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

const VALID_LB_POLICIES: LoadBalancingPolicy[] = ["random", "round_robin", "least_conn", "ip_hash", "first", "header", "cookie", "uri_hash"];

function sanitizeLoadBalancerMeta(meta: LoadBalancerMeta | undefined): LoadBalancerMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const normalized: LoadBalancerMeta = {};

  if (meta.enabled !== undefined) {
    normalized.enabled = Boolean(meta.enabled);
  }

  if (meta.policy && VALID_LB_POLICIES.includes(meta.policy as LoadBalancingPolicy)) {
    normalized.policy = meta.policy;
  }

  const headerField = normalizeMetaValue(meta.policy_header_field ?? null);
  if (headerField) {
    normalized.policy_header_field = headerField;
  }

  const cookieName = normalizeMetaValue(meta.policy_cookie_name ?? null);
  if (cookieName) {
    normalized.policy_cookie_name = cookieName;
  }

  const cookieSecret = normalizeMetaValue(meta.policy_cookie_secret ?? null);
  if (cookieSecret) {
    normalized.policy_cookie_secret = cookieSecret;
  }

  const tryDuration = normalizeMetaValue(meta.try_duration ?? null);
  if (tryDuration) {
    normalized.try_duration = tryDuration;
  }

  const tryInterval = normalizeMetaValue(meta.try_interval ?? null);
  if (tryInterval) {
    normalized.try_interval = tryInterval;
  }

  if (typeof meta.retries === "number" && Number.isFinite(meta.retries) && meta.retries >= 0) {
    normalized.retries = meta.retries;
  }

  if (meta.active_health_check) {
    const ahc: LoadBalancerActiveHealthCheckMeta = {};
    if (meta.active_health_check.enabled !== undefined) {
      ahc.enabled = Boolean(meta.active_health_check.enabled);
    }
    const uri = normalizeMetaValue(meta.active_health_check.uri ?? null);
    if (uri) {
      ahc.uri = uri;
    }
    if (typeof meta.active_health_check.port === "number" && Number.isFinite(meta.active_health_check.port) && meta.active_health_check.port > 0) {
      ahc.port = meta.active_health_check.port;
    }
    const interval = normalizeMetaValue(meta.active_health_check.interval ?? null);
    if (interval) {
      ahc.interval = interval;
    }
    const timeout = normalizeMetaValue(meta.active_health_check.timeout ?? null);
    if (timeout) {
      ahc.timeout = timeout;
    }
    if (typeof meta.active_health_check.status === "number" && Number.isFinite(meta.active_health_check.status) && meta.active_health_check.status >= 100) {
      ahc.status = meta.active_health_check.status;
    }
    const body = normalizeMetaValue(meta.active_health_check.body ?? null);
    if (body) {
      ahc.body = body;
    }
    if (Object.keys(ahc).length > 0) {
      normalized.active_health_check = ahc;
    }
  }

  if (meta.passive_health_check) {
    const phc: LoadBalancerPassiveHealthCheckMeta = {};
    if (meta.passive_health_check.enabled !== undefined) {
      phc.enabled = Boolean(meta.passive_health_check.enabled);
    }
    const failDuration = normalizeMetaValue(meta.passive_health_check.fail_duration ?? null);
    if (failDuration) {
      phc.fail_duration = failDuration;
    }
    if (typeof meta.passive_health_check.max_fails === "number" && Number.isFinite(meta.passive_health_check.max_fails) && meta.passive_health_check.max_fails >= 0) {
      phc.max_fails = meta.passive_health_check.max_fails;
    }
    if (Array.isArray(meta.passive_health_check.unhealthy_status)) {
      const statuses = meta.passive_health_check.unhealthy_status.filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 100);
      if (statuses.length > 0) {
        phc.unhealthy_status = statuses;
      }
    }
    const unhealthyLatency = normalizeMetaValue(meta.passive_health_check.unhealthy_latency ?? null);
    if (unhealthyLatency) {
      phc.unhealthy_latency = unhealthyLatency;
    }
    if (Object.keys(phc).length > 0) {
      normalized.passive_health_check = phc;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function sanitizeDnsResolverMeta(meta: DnsResolverMeta | undefined): DnsResolverMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const normalized: DnsResolverMeta = {};

  if (meta.enabled !== undefined) {
    normalized.enabled = Boolean(meta.enabled);
  }

  if (Array.isArray(meta.resolvers)) {
    const resolvers = meta.resolvers
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter((r) => r.length > 0);
    if (resolvers.length > 0) {
      normalized.resolvers = resolvers;
    }
  }

  if (Array.isArray(meta.fallbacks)) {
    const fallbacks = meta.fallbacks
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter((r) => r.length > 0);
    if (fallbacks.length > 0) {
      normalized.fallbacks = fallbacks;
    }
  }

  const timeout = normalizeMetaValue(meta.timeout ?? null);
  if (timeout) {
    normalized.timeout = timeout;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function serializeMeta(meta: ProxyHostMeta | null | undefined) {
  if (!meta) {
    return null;
  }
  const normalized: ProxyHostMeta = {};
  const reverse = normalizeMetaValue(meta.custom_reverse_proxy_json ?? null);
  const preHandlers = normalizeMetaValue(meta.custom_pre_handlers_json ?? null);

  if (reverse) {
    normalized.custom_reverse_proxy_json = reverse;
  }
  if (preHandlers) {
    normalized.custom_pre_handlers_json = preHandlers;
  }

  const authentik = sanitizeAuthentikMeta(meta.authentik);
  if (authentik) {
    normalized.authentik = authentik;
  }

  const loadBalancer = sanitizeLoadBalancerMeta(meta.load_balancer);
  if (loadBalancer) {
    normalized.load_balancer = loadBalancer;
  }

  const dnsResolver = sanitizeDnsResolverMeta(meta.dns_resolver);
  if (dnsResolver) {
    normalized.dns_resolver = dnsResolver;
  }

  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function parseMeta(value: string | null): ProxyHostMeta {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as ProxyHostMeta;
    return {
      custom_reverse_proxy_json: normalizeMetaValue(parsed.custom_reverse_proxy_json ?? null) ?? undefined,
      custom_pre_handlers_json: normalizeMetaValue(parsed.custom_pre_handlers_json ?? null) ?? undefined,
      authentik: sanitizeAuthentikMeta(parsed.authentik),
      load_balancer: sanitizeLoadBalancerMeta(parsed.load_balancer),
      dns_resolver: sanitizeDnsResolverMeta(parsed.dns_resolver)
    };
  } catch (error) {
    console.warn("Failed to parse proxy host meta", error);
    return {};
  }
}

function normalizeAuthentikInput(
  input: ProxyHostAuthentikInput | null | undefined,
  existing: ProxyHostAuthentikMeta | undefined
): ProxyHostAuthentikMeta | undefined {
  if (input === undefined) {
    return existing;
  }
  if (input === null) {
    return undefined;
  }

  const next: ProxyHostAuthentikMeta = { ...(existing ?? {}) };

  if (input.enabled !== undefined) {
    next.enabled = Boolean(input.enabled);
  }

  if (input.outpostDomain !== undefined) {
    const domain = normalizeMetaValue(input.outpostDomain ?? null);
    if (domain) {
      next.outpost_domain = domain;
    } else {
      delete next.outpost_domain;
    }
  }

  if (input.outpostUpstream !== undefined) {
    const upstream = normalizeMetaValue(input.outpostUpstream ?? null);
    if (upstream) {
      next.outpost_upstream = upstream;
    } else {
      delete next.outpost_upstream;
    }
  }

  if (input.authEndpoint !== undefined) {
    const endpoint = normalizeMetaValue(input.authEndpoint ?? null);
    if (endpoint) {
      next.auth_endpoint = endpoint;
    } else {
      delete next.auth_endpoint;
    }
  }

  if (input.copyHeaders !== undefined) {
    const headers = (input.copyHeaders ?? [])
      .map((header) => header?.trim())
      .filter((header): header is string => Boolean(header));
    if (headers.length > 0) {
      next.copy_headers = headers;
    } else {
      delete next.copy_headers;
    }
  }

  if (input.trustedProxies !== undefined) {
    const proxies = (input.trustedProxies ?? [])
      .map((proxy) => proxy?.trim())
      .filter((proxy): proxy is string => Boolean(proxy));
    if (proxies.length > 0) {
      next.trusted_proxies = proxies;
    } else {
      delete next.trusted_proxies;
    }
  }

  if (input.setOutpostHostHeader !== undefined) {
    next.set_outpost_host_header = Boolean(input.setOutpostHostHeader);
  }

  if (input.protectedPaths !== undefined) {
    const paths = (input.protectedPaths ?? [])
      .map((path) => path?.trim())
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      next.protected_paths = paths;
    } else {
      delete next.protected_paths;
    }
  }

  if ((next.enabled ?? false) && next.outpost_domain && !next.auth_endpoint) {
    next.auth_endpoint = `/${next.outpost_domain}/auth/caddy`;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeLoadBalancerInput(
  input: LoadBalancerInput | null | undefined,
  existing: LoadBalancerMeta | undefined
): LoadBalancerMeta | undefined {
  if (input === undefined) {
    return existing;
  }
  if (input === null) {
    return undefined;
  }

  const next: LoadBalancerMeta = { ...(existing ?? {}) };

  if (input.enabled !== undefined) {
    next.enabled = Boolean(input.enabled);
  }

  if (input.policy !== undefined) {
    if (input.policy && VALID_LB_POLICIES.includes(input.policy)) {
      next.policy = input.policy;
    } else {
      delete next.policy;
    }
  }

  if (input.policyHeaderField !== undefined) {
    const val = normalizeMetaValue(input.policyHeaderField ?? null);
    if (val) {
      next.policy_header_field = val;
    } else {
      delete next.policy_header_field;
    }
  }

  if (input.policyCookieName !== undefined) {
    const val = normalizeMetaValue(input.policyCookieName ?? null);
    if (val) {
      next.policy_cookie_name = val;
    } else {
      delete next.policy_cookie_name;
    }
  }

  if (input.policyCookieSecret !== undefined) {
    const val = normalizeMetaValue(input.policyCookieSecret ?? null);
    if (val) {
      next.policy_cookie_secret = val;
    } else {
      delete next.policy_cookie_secret;
    }
  }

  if (input.tryDuration !== undefined) {
    const val = normalizeMetaValue(input.tryDuration ?? null);
    if (val) {
      next.try_duration = val;
    } else {
      delete next.try_duration;
    }
  }

  if (input.tryInterval !== undefined) {
    const val = normalizeMetaValue(input.tryInterval ?? null);
    if (val) {
      next.try_interval = val;
    } else {
      delete next.try_interval;
    }
  }

  if (input.retries !== undefined) {
    if (typeof input.retries === "number" && Number.isFinite(input.retries) && input.retries >= 0) {
      next.retries = input.retries;
    } else {
      delete next.retries;
    }
  }

  if (input.activeHealthCheck !== undefined) {
    if (input.activeHealthCheck === null) {
      delete next.active_health_check;
    } else {
      const ahc: LoadBalancerActiveHealthCheckMeta = { ...(existing?.active_health_check ?? {}) };

      if (input.activeHealthCheck.enabled !== undefined) {
        ahc.enabled = Boolean(input.activeHealthCheck.enabled);
      }
      if (input.activeHealthCheck.uri !== undefined) {
        const val = normalizeMetaValue(input.activeHealthCheck.uri ?? null);
        if (val) {
          ahc.uri = val;
        } else {
          delete ahc.uri;
        }
      }
      if (input.activeHealthCheck.port !== undefined) {
        if (typeof input.activeHealthCheck.port === "number" && Number.isFinite(input.activeHealthCheck.port) && input.activeHealthCheck.port > 0) {
          ahc.port = input.activeHealthCheck.port;
        } else {
          delete ahc.port;
        }
      }
      if (input.activeHealthCheck.interval !== undefined) {
        const val = normalizeMetaValue(input.activeHealthCheck.interval ?? null);
        if (val) {
          ahc.interval = val;
        } else {
          delete ahc.interval;
        }
      }
      if (input.activeHealthCheck.timeout !== undefined) {
        const val = normalizeMetaValue(input.activeHealthCheck.timeout ?? null);
        if (val) {
          ahc.timeout = val;
        } else {
          delete ahc.timeout;
        }
      }
      if (input.activeHealthCheck.status !== undefined) {
        if (typeof input.activeHealthCheck.status === "number" && Number.isFinite(input.activeHealthCheck.status) && input.activeHealthCheck.status >= 100) {
          ahc.status = input.activeHealthCheck.status;
        } else {
          delete ahc.status;
        }
      }
      if (input.activeHealthCheck.body !== undefined) {
        const val = normalizeMetaValue(input.activeHealthCheck.body ?? null);
        if (val) {
          ahc.body = val;
        } else {
          delete ahc.body;
        }
      }

      if (Object.keys(ahc).length > 0) {
        next.active_health_check = ahc;
      } else {
        delete next.active_health_check;
      }
    }
  }

  if (input.passiveHealthCheck !== undefined) {
    if (input.passiveHealthCheck === null) {
      delete next.passive_health_check;
    } else {
      const phc: LoadBalancerPassiveHealthCheckMeta = { ...(existing?.passive_health_check ?? {}) };

      if (input.passiveHealthCheck.enabled !== undefined) {
        phc.enabled = Boolean(input.passiveHealthCheck.enabled);
      }
      if (input.passiveHealthCheck.failDuration !== undefined) {
        const val = normalizeMetaValue(input.passiveHealthCheck.failDuration ?? null);
        if (val) {
          phc.fail_duration = val;
        } else {
          delete phc.fail_duration;
        }
      }
      if (input.passiveHealthCheck.maxFails !== undefined) {
        if (typeof input.passiveHealthCheck.maxFails === "number" && Number.isFinite(input.passiveHealthCheck.maxFails) && input.passiveHealthCheck.maxFails >= 0) {
          phc.max_fails = input.passiveHealthCheck.maxFails;
        } else {
          delete phc.max_fails;
        }
      }
      if (input.passiveHealthCheck.unhealthyStatus !== undefined) {
        if (Array.isArray(input.passiveHealthCheck.unhealthyStatus)) {
          const statuses = input.passiveHealthCheck.unhealthyStatus.filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 100);
          if (statuses.length > 0) {
            phc.unhealthy_status = statuses;
          } else {
            delete phc.unhealthy_status;
          }
        } else {
          delete phc.unhealthy_status;
        }
      }
      if (input.passiveHealthCheck.unhealthyLatency !== undefined) {
        const val = normalizeMetaValue(input.passiveHealthCheck.unhealthyLatency ?? null);
        if (val) {
          phc.unhealthy_latency = val;
        } else {
          delete phc.unhealthy_latency;
        }
      }

      if (Object.keys(phc).length > 0) {
        next.passive_health_check = phc;
      } else {
        delete next.passive_health_check;
      }
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeDnsResolverInput(
  input: DnsResolverInput | null | undefined,
  existing: DnsResolverMeta | undefined
): DnsResolverMeta | undefined {
  if (input === undefined) {
    return existing;
  }
  if (input === null) {
    return undefined;
  }

  const next: DnsResolverMeta = { ...(existing ?? {}) };

  if (input.enabled !== undefined) {
    next.enabled = Boolean(input.enabled);
  }

  if (input.resolvers !== undefined) {
    if (Array.isArray(input.resolvers)) {
      const resolvers = input.resolvers
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter((r) => r.length > 0);
      if (resolvers.length > 0) {
        next.resolvers = resolvers;
      } else {
        delete next.resolvers;
      }
    } else {
      delete next.resolvers;
    }
  }

  if (input.fallbacks !== undefined) {
    if (Array.isArray(input.fallbacks)) {
      const fallbacks = input.fallbacks
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter((r) => r.length > 0);
      if (fallbacks.length > 0) {
        next.fallbacks = fallbacks;
      } else {
        delete next.fallbacks;
      }
    } else {
      delete next.fallbacks;
    }
  }

  if (input.timeout !== undefined) {
    const val = normalizeMetaValue(input.timeout ?? null);
    if (val) {
      next.timeout = val;
    } else {
      delete next.timeout;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildMeta(existing: ProxyHostMeta, input: Partial<ProxyHostInput>): string | null {
  const next: ProxyHostMeta = { ...existing };

  if (input.custom_reverse_proxy_json !== undefined) {
    const reverse = normalizeMetaValue(input.custom_reverse_proxy_json ?? null);
    if (reverse) {
      next.custom_reverse_proxy_json = reverse;
    } else {
      delete next.custom_reverse_proxy_json;
    }
  }

  if (input.custom_pre_handlers_json !== undefined) {
    const pre = normalizeMetaValue(input.custom_pre_handlers_json ?? null);
    if (pre) {
      next.custom_pre_handlers_json = pre;
    } else {
      delete next.custom_pre_handlers_json;
    }
  }

  if (input.authentik !== undefined) {
    const authentik = normalizeAuthentikInput(input.authentik, existing.authentik);
    if (authentik) {
      next.authentik = authentik;
    } else {
      delete next.authentik;
    }
  }

  if (input.load_balancer !== undefined) {
    const loadBalancer = normalizeLoadBalancerInput(input.load_balancer, existing.load_balancer);
    if (loadBalancer) {
      next.load_balancer = loadBalancer;
    } else {
      delete next.load_balancer;
    }
  }

  if (input.dns_resolver !== undefined) {
    const dnsResolver = normalizeDnsResolverInput(input.dns_resolver, existing.dns_resolver);
    if (dnsResolver) {
      next.dns_resolver = dnsResolver;
    } else {
      delete next.dns_resolver;
    }
  }

  return serializeMeta(next);
}

function hydrateAuthentik(meta: ProxyHostAuthentikMeta | undefined): ProxyHostAuthentikConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = Boolean(meta.enabled);
  const outpostDomain = normalizeMetaValue(meta.outpost_domain ?? null);
  const outpostUpstream = normalizeMetaValue(meta.outpost_upstream ?? null);
  const authEndpoint =
    normalizeMetaValue(meta.auth_endpoint ?? null) ?? (outpostDomain ? `/${outpostDomain}/auth/caddy` : null);
  const copyHeaders =
    Array.isArray(meta.copy_headers) && meta.copy_headers.length > 0 ? meta.copy_headers : DEFAULT_AUTHENTIK_HEADERS;
  const trustedProxies =
    Array.isArray(meta.trusted_proxies) && meta.trusted_proxies.length > 0
      ? meta.trusted_proxies
      : DEFAULT_AUTHENTIK_TRUSTED_PROXIES;
  const setOutpostHostHeader =
    meta.set_outpost_host_header !== undefined ? Boolean(meta.set_outpost_host_header) : true;
  const protectedPaths =
    Array.isArray(meta.protected_paths) && meta.protected_paths.length > 0 ? meta.protected_paths : null;

  return {
    enabled,
    outpostDomain,
    outpostUpstream,
    authEndpoint,
    copyHeaders,
    trustedProxies,
    setOutpostHostHeader,
    protectedPaths
  };
}

function dehydrateAuthentik(config: ProxyHostAuthentikConfig | null): ProxyHostAuthentikMeta | undefined {
  if (!config) {
    return undefined;
  }

  const meta: ProxyHostAuthentikMeta = {
    enabled: config.enabled
  };

  if (config.outpostDomain) {
    meta.outpost_domain = config.outpostDomain;
  }
  if (config.outpostUpstream) {
    meta.outpost_upstream = config.outpostUpstream;
  }
  if (config.authEndpoint) {
    meta.auth_endpoint = config.authEndpoint;
  }
  if (config.copyHeaders.length > 0) {
    meta.copy_headers = [...config.copyHeaders];
  }
  if (config.trustedProxies.length > 0) {
    meta.trusted_proxies = [...config.trustedProxies];
  }
  meta.set_outpost_host_header = config.setOutpostHostHeader;
  if (config.protectedPaths && config.protectedPaths.length > 0) {
    meta.protected_paths = [...config.protectedPaths];
  }

  return meta;
}

function hydrateLoadBalancer(meta: LoadBalancerMeta | undefined): LoadBalancerConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = Boolean(meta.enabled);
  const policy: LoadBalancingPolicy = (meta.policy && VALID_LB_POLICIES.includes(meta.policy as LoadBalancingPolicy))
    ? (meta.policy as LoadBalancingPolicy)
    : "random";

  const policyHeaderField = normalizeMetaValue(meta.policy_header_field ?? null);
  const policyCookieName = normalizeMetaValue(meta.policy_cookie_name ?? null);
  const policyCookieSecret = normalizeMetaValue(meta.policy_cookie_secret ?? null);
  const tryDuration = normalizeMetaValue(meta.try_duration ?? null);
  const tryInterval = normalizeMetaValue(meta.try_interval ?? null);
  const retries = typeof meta.retries === "number" && Number.isFinite(meta.retries) && meta.retries >= 0 ? meta.retries : null;

  let activeHealthCheck: LoadBalancerActiveHealthCheck | null = null;
  if (meta.active_health_check) {
    activeHealthCheck = {
      enabled: Boolean(meta.active_health_check.enabled),
      uri: normalizeMetaValue(meta.active_health_check.uri ?? null),
      port: typeof meta.active_health_check.port === "number" && Number.isFinite(meta.active_health_check.port) && meta.active_health_check.port > 0
        ? meta.active_health_check.port
        : null,
      interval: normalizeMetaValue(meta.active_health_check.interval ?? null),
      timeout: normalizeMetaValue(meta.active_health_check.timeout ?? null),
      status: typeof meta.active_health_check.status === "number" && Number.isFinite(meta.active_health_check.status) && meta.active_health_check.status >= 100
        ? meta.active_health_check.status
        : null,
      body: normalizeMetaValue(meta.active_health_check.body ?? null)
    };
  }

  let passiveHealthCheck: LoadBalancerPassiveHealthCheck | null = null;
  if (meta.passive_health_check) {
    const unhealthyStatus = Array.isArray(meta.passive_health_check.unhealthy_status)
      ? meta.passive_health_check.unhealthy_status.filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 100)
      : null;

    passiveHealthCheck = {
      enabled: Boolean(meta.passive_health_check.enabled),
      failDuration: normalizeMetaValue(meta.passive_health_check.fail_duration ?? null),
      maxFails: typeof meta.passive_health_check.max_fails === "number" && Number.isFinite(meta.passive_health_check.max_fails) && meta.passive_health_check.max_fails >= 0
        ? meta.passive_health_check.max_fails
        : null,
      unhealthyStatus: unhealthyStatus && unhealthyStatus.length > 0 ? unhealthyStatus : null,
      unhealthyLatency: normalizeMetaValue(meta.passive_health_check.unhealthy_latency ?? null)
    };
  }

  return {
    enabled,
    policy,
    policyHeaderField,
    policyCookieName,
    policyCookieSecret,
    tryDuration,
    tryInterval,
    retries,
    activeHealthCheck,
    passiveHealthCheck
  };
}

function dehydrateLoadBalancer(config: LoadBalancerConfig | null): LoadBalancerMeta | undefined {
  if (!config) {
    return undefined;
  }

  const meta: LoadBalancerMeta = {
    enabled: config.enabled
  };

  if (config.policy) {
    meta.policy = config.policy;
  }
  if (config.policyHeaderField) {
    meta.policy_header_field = config.policyHeaderField;
  }
  if (config.policyCookieName) {
    meta.policy_cookie_name = config.policyCookieName;
  }
  if (config.policyCookieSecret) {
    meta.policy_cookie_secret = config.policyCookieSecret;
  }
  if (config.tryDuration) {
    meta.try_duration = config.tryDuration;
  }
  if (config.tryInterval) {
    meta.try_interval = config.tryInterval;
  }
  if (config.retries !== null) {
    meta.retries = config.retries;
  }

  if (config.activeHealthCheck) {
    const ahc: LoadBalancerActiveHealthCheckMeta = {
      enabled: config.activeHealthCheck.enabled
    };
    if (config.activeHealthCheck.uri) {
      ahc.uri = config.activeHealthCheck.uri;
    }
    if (config.activeHealthCheck.port !== null) {
      ahc.port = config.activeHealthCheck.port;
    }
    if (config.activeHealthCheck.interval) {
      ahc.interval = config.activeHealthCheck.interval;
    }
    if (config.activeHealthCheck.timeout) {
      ahc.timeout = config.activeHealthCheck.timeout;
    }
    if (config.activeHealthCheck.status !== null) {
      ahc.status = config.activeHealthCheck.status;
    }
    if (config.activeHealthCheck.body) {
      ahc.body = config.activeHealthCheck.body;
    }
    meta.active_health_check = ahc;
  }

  if (config.passiveHealthCheck) {
    const phc: LoadBalancerPassiveHealthCheckMeta = {
      enabled: config.passiveHealthCheck.enabled
    };
    if (config.passiveHealthCheck.failDuration) {
      phc.fail_duration = config.passiveHealthCheck.failDuration;
    }
    if (config.passiveHealthCheck.maxFails !== null) {
      phc.max_fails = config.passiveHealthCheck.maxFails;
    }
    if (config.passiveHealthCheck.unhealthyStatus && config.passiveHealthCheck.unhealthyStatus.length > 0) {
      phc.unhealthy_status = [...config.passiveHealthCheck.unhealthyStatus];
    }
    if (config.passiveHealthCheck.unhealthyLatency) {
      phc.unhealthy_latency = config.passiveHealthCheck.unhealthyLatency;
    }
    meta.passive_health_check = phc;
  }

  return meta;
}

function hydrateDnsResolver(meta: DnsResolverMeta | undefined): DnsResolverConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = Boolean(meta.enabled);

  const resolvers = Array.isArray(meta.resolvers)
    ? meta.resolvers.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : [];

  const fallbacks = Array.isArray(meta.fallbacks)
    ? meta.fallbacks.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : null;

  const timeout = normalizeMetaValue(meta.timeout ?? null);

  return {
    enabled,
    resolvers,
    fallbacks: fallbacks && fallbacks.length > 0 ? fallbacks : null,
    timeout
  };
}

function dehydrateDnsResolver(config: DnsResolverConfig | null): DnsResolverMeta | undefined {
  if (!config) {
    return undefined;
  }

  const meta: DnsResolverMeta = {
    enabled: config.enabled
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

function parseProxyHost(row: ProxyHostRow): ProxyHost {
  const meta = parseMeta(row.meta ?? null);
  return {
    id: row.id,
    name: row.name,
    domains: JSON.parse(row.domains),
    upstreams: JSON.parse(row.upstreams),
    certificate_id: row.certificateId ?? null,
    access_list_id: row.accessListId ?? null,
    ssl_forced: row.sslForced,
    hsts_enabled: row.hstsEnabled,
    hsts_subdomains: row.hstsSubdomains,
    allow_websocket: row.allowWebsocket,
    preserve_host_header: row.preserveHostHeader,
    skip_https_hostname_validation: row.skipHttpsHostnameValidation,
    enabled: row.enabled,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!,
    custom_reverse_proxy_json: meta.custom_reverse_proxy_json ?? null,
    custom_pre_handlers_json: meta.custom_pre_handlers_json ?? null,
    authentik: hydrateAuthentik(meta.authentik),
    load_balancer: hydrateLoadBalancer(meta.load_balancer),
    dns_resolver: hydrateDnsResolver(meta.dns_resolver)
  };
}

export async function listProxyHosts(): Promise<ProxyHost[]> {
  const hosts = await db.select().from(proxyHosts).orderBy(desc(proxyHosts.createdAt));
  return hosts.map(parseProxyHost);
}

export async function createProxyHost(input: ProxyHostInput, actorUserId: number) {
  if (!input.domains || input.domains.length === 0) {
    throw new Error("At least one domain must be specified");
  }
  if (!input.upstreams || input.upstreams.length === 0) {
    throw new Error("At least one upstream must be specified");
  }

  const now = nowIso();
  const meta = buildMeta({}, input);
  const [record] = await db
    .insert(proxyHosts)
    .values({
      name: input.name.trim(),
      domains: JSON.stringify(Array.from(new Set(input.domains.map((d) => d.trim().toLowerCase())))),
      upstreams: JSON.stringify(Array.from(new Set(input.upstreams.map((u) => u.trim())))),
      certificateId: input.certificate_id ?? null,
      accessListId: input.access_list_id ?? null,
      ownerUserId: actorUserId,
      sslForced: input.ssl_forced ?? true,
      hstsEnabled: input.hsts_enabled ?? true,
      hstsSubdomains: input.hsts_subdomains ?? false,
      allowWebsocket: input.allow_websocket ?? true,
      preserveHostHeader: input.preserve_host_header ?? true,
      meta,
      skipHttpsHostnameValidation: input.skip_https_hostname_validation ?? false,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create proxy host");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "proxy_host",
    entityId: record.id,
    summary: `Created proxy host ${input.name}`,
    data: input
  });

  await applyCaddyConfig();
  return (await getProxyHost(record.id))!;
}

export async function getProxyHost(id: number): Promise<ProxyHost | null> {
  const host = await db.query.proxyHosts.findFirst({
    where: (table, { eq }) => eq(table.id, id)
  });
  return host ? parseProxyHost(host) : null;
}

export async function updateProxyHost(id: number, input: Partial<ProxyHostInput>, actorUserId: number) {
  const existing = await getProxyHost(id);
  if (!existing) {
    throw new Error("Proxy host not found");
  }

  const domains = input.domains ? JSON.stringify(Array.from(new Set(input.domains))) : JSON.stringify(existing.domains);
  const upstreams = input.upstreams ? JSON.stringify(Array.from(new Set(input.upstreams))) : JSON.stringify(existing.upstreams);
  const existingMeta: ProxyHostMeta = {
    custom_reverse_proxy_json: existing.custom_reverse_proxy_json ?? undefined,
    custom_pre_handlers_json: existing.custom_pre_handlers_json ?? undefined,
    authentik: dehydrateAuthentik(existing.authentik),
    load_balancer: dehydrateLoadBalancer(existing.load_balancer),
    dns_resolver: dehydrateDnsResolver(existing.dns_resolver)
  };
  const meta = buildMeta(existingMeta, input);

  const now = nowIso();
  await db
    .update(proxyHosts)
    .set({
      name: input.name ?? existing.name,
      domains,
      upstreams,
      certificateId: input.certificate_id !== undefined ? input.certificate_id : existing.certificate_id,
      accessListId: input.access_list_id !== undefined ? input.access_list_id : existing.access_list_id,
      sslForced: input.ssl_forced ?? existing.ssl_forced,
      hstsEnabled: input.hsts_enabled ?? existing.hsts_enabled,
      hstsSubdomains: input.hsts_subdomains ?? existing.hsts_subdomains,
      allowWebsocket: input.allow_websocket ?? existing.allow_websocket,
      preserveHostHeader: input.preserve_host_header ?? existing.preserve_host_header,
      meta,
      skipHttpsHostnameValidation: input.skip_https_hostname_validation ?? existing.skip_https_hostname_validation,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: now
    })
    .where(eq(proxyHosts.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "proxy_host",
    entityId: id,
    summary: `Updated proxy host ${input.name ?? existing.name}`,
    data: input
  });

  await applyCaddyConfig();
  return (await getProxyHost(id))!;
}

export async function deleteProxyHost(id: number, actorUserId: number) {
  const existing = await getProxyHost(id);
  if (!existing) {
    throw new Error("Proxy host not found");
  }

  await db.delete(proxyHosts).where(eq(proxyHosts.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "proxy_host",
    entityId: id,
    summary: `Deleted proxy host ${existing.name}`
  });
  await applyCaddyConfig();
}
