import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { proxyHosts } from "../db/schema";
import { asc, desc, eq, count, like, or } from "drizzle-orm";
import { type GeoBlockSettings } from "../settings";
import { normalizeProxyHostDomains } from "../proxy-host-domains";

// Security: Only the protocol scheme is validated (http/https). Host/IP targets are
// not restricted — admins intentionally need to proxy to internal services.
// The Caddy admin API (port 2019) is protected by origins checking, not network isolation.
function validateUpstreamProtocol(upstream: string): void {
  const trimmed = upstream.trim();
  if (!trimmed) return;
  // If upstream contains "://", enforce http or https scheme
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new Error(`Invalid upstream protocol "${scheme}://". Only http:// and https:// are allowed`);
    }
  }
}

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
const VALID_UPSTREAM_DNS_FAMILIES: UpstreamDnsAddressFamily[] = ["ipv6", "ipv4", "both"];

export type GeoBlockMode = "merge" | "override";

export type WafMode = "merge" | "override";

export type RedirectRule = {
  from: string;   // path pattern e.g. "/.well-known/carddav"
  to: string;     // destination e.g. "/remote.php/dav/"
  status: 301 | 302 | 307 | 308;
};

export type RewriteConfig = {
  path_prefix: string; // e.g. "/recipes"
};

export type LocationRule = {
  path: string;      // Caddy path pattern, e.g. "/ws/*", "/api/*"
  upstreams: string[]; // e.g. ["backend:8080", "backend2:8080"]
};

export const PATH_BLOCK_STATUS_CODES = [400, 401, 403, 404, 410, 418, 451, 500, 502, 503] as const;
export type PathBlockStatusCode = (typeof PATH_BLOCK_STATUS_CODES)[number];

export type PathBlockRule = {
  path: string;                    // Caddy path pattern, e.g. "/dns-query"
  status: PathBlockStatusCode;     // status code to return, e.g. 403
  body?: string;                   // optional response body, e.g. "Forbidden"
};

export type PathRewriteRule = {
  from: string;   // path pattern, e.g. "/secretpath"
  to: string;     // internal target URI, e.g. "/dns-query"
};

// Suggested status codes for the error-page UI. Any 4xx/5xx code is accepted by
// the sanitizer; this list only drives the picker.
export const ERROR_PAGE_STATUS_CODES = [400, 401, 403, 404, 408, 429, 500, 502, 503, 504] as const;

export type ErrorPageRule = {
  statuses: number[];     // error codes this rule handles, e.g. [502, 503, 504]; empty = all errors
  body: string;           // response body (HTML/text); the original status code is preserved
  contentType?: string;   // optional Content-Type, defaults to "text/html; charset=utf-8"
};

export type PathAllowRule = {
  path: string;   // Caddy path pattern, e.g. "/secret" — matches short-circuit the
                  // subroute (no block applies) and the request falls through to the
                  // upstream proxy.
};

export type WafHostConfig = {
  enabled?: boolean;
  mode?: 'Off' | 'On';
  load_owasp_crs?: boolean;
  custom_directives?: string;
  excluded_rule_ids?: number[];
  waf_mode?: WafMode;
};

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

export type UpstreamDnsAddressFamily = "ipv6" | "ipv4" | "both";

export type UpstreamDnsResolutionConfig = {
  enabled: boolean | null;
  family: UpstreamDnsAddressFamily | null;
};

export type UpstreamDnsResolutionInput = {
  enabled?: boolean | null;
  family?: UpstreamDnsAddressFamily | null;
};

type UpstreamDnsResolutionMeta = {
  enabled?: boolean;
  family?: UpstreamDnsAddressFamily;
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
  excludedPaths: string[] | null;
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
  excludedPaths?: string[] | null;
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
  excluded_paths?: string[];
};

export type MtlsConfig = {
  enabled: boolean;
  /** Trust specific issued client certificates (derives CAs automatically) */
  trusted_client_cert_ids?: number[];
  /** Trust all certificates belonging to these roles */
  trusted_role_ids?: number[];
  protected_paths?: string[] | null;
  excluded_paths?: string[] | null;
  /** @deprecated Old model: trust entire CAs. Kept for backward compat migration. */
  ca_certificate_ids?: number[];
};

function sanitizeMtlsMeta(meta: MtlsConfig | undefined): MtlsConfig | undefined {
  if (!meta?.enabled) {
    return undefined;
  }

  const normalized: MtlsConfig = { enabled: true };

  if (Array.isArray(meta.trusted_client_cert_ids)) {
    const certIds = meta.trusted_client_cert_ids.filter((id): id is number => Number.isFinite(id) && id > 0);
    if (certIds.length > 0) {
      normalized.trusted_client_cert_ids = certIds;
    }
  }

  if (Array.isArray(meta.trusted_role_ids)) {
    const roleIds = meta.trusted_role_ids.filter((id): id is number => Number.isFinite(id) && id > 0);
    if (roleIds.length > 0) {
      normalized.trusted_role_ids = roleIds;
    }
  }

  if (Array.isArray(meta.protected_paths)) {
    const paths = meta.protected_paths.map((path) => path?.trim().replace(/\{[^}]*\}/g, "")).filter((path): path is string => Boolean(path)); // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
    if (paths.length > 0) {
      normalized.protected_paths = paths;
    }
  }

  if (Array.isArray(meta.excluded_paths)) {
    const paths = meta.excluded_paths.map((path) => path?.trim().replace(/\{[^}]*\}/g, "")).filter((path): path is string => Boolean(path)); // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
    if (paths.length > 0) {
      normalized.excluded_paths = paths;
    }
  }

  if (Array.isArray(meta.ca_certificate_ids)) {
    const caIds = meta.ca_certificate_ids.filter((id): id is number => Number.isFinite(id) && id > 0);
    if (caIds.length > 0) {
      normalized.ca_certificate_ids = caIds;
    }
  }

  return normalized;
}

export type CpmForwardAuthConfig = {
  enabled: boolean;
  protected_paths: string[] | null;
  excluded_paths: string[] | null;
};

export type CpmForwardAuthInput = {
  enabled?: boolean;
  protected_paths?: string[] | null;
  excluded_paths?: string[] | null;
};

type CpmForwardAuthMeta = {
  enabled?: boolean;
  protected_paths?: string[];
  excluded_paths?: string[];
};

type ProxyHostMeta = {
  custom_reverse_proxy_json?: string;
  custom_pre_handlers_json?: string;
  authentik?: ProxyHostAuthentikMeta;
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
  upstream_dns_resolution?: UpstreamDnsResolutionMeta;
  geoblock?: GeoBlockSettings;
  geoblock_mode?: GeoBlockMode;
  waf?: WafHostConfig;
  mtls?: MtlsConfig;
  cpm_forward_auth?: CpmForwardAuthMeta;
  redirects?: RedirectRule[];
  rewrite?: RewriteConfig;
  location_rules?: LocationRule[];
  path_allows?: PathAllowRule[];
  path_blocks?: PathBlockRule[];
  path_rewrites?: PathRewriteRule[];
  error_pages?: ErrorPageRule[];
};

export type ProxyHost = {
  id: number;
  name: string;
  domains: string[];
  upstreams: string[];
  certificateId: number | null;
  accessListId: number | null;
  sslForced: boolean;
  hstsEnabled: boolean;
  hstsSubdomains: boolean;
  allowWebsocket: boolean;
  preserveHostHeader: boolean;
  skipHttpsHostnameValidation: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  customReverseProxyJson: string | null;
  customPreHandlersJson: string | null;
  authentik: ProxyHostAuthentikConfig | null;
  loadBalancer: LoadBalancerConfig | null;
  dnsResolver: DnsResolverConfig | null;
  upstreamDnsResolution: UpstreamDnsResolutionConfig | null;
  geoblock: GeoBlockSettings | null;
  geoblockMode: GeoBlockMode;
  waf: WafHostConfig | null;
  mtls: MtlsConfig | null;
  cpmForwardAuth: CpmForwardAuthConfig | null;
  redirects: RedirectRule[];
  rewrite: RewriteConfig | null;
  locationRules: LocationRule[];
  pathAllows: PathAllowRule[];
  pathBlocks: PathBlockRule[];
  pathRewrites: PathRewriteRule[];
  errorPages: ErrorPageRule[];
};

export type ProxyHostInput = {
  name: string;
  domains: string[];
  upstreams: string[];
  certificateId?: number | null;
  accessListId?: number | null;
  sslForced?: boolean;
  hstsEnabled?: boolean;
  hstsSubdomains?: boolean;
  allowWebsocket?: boolean;
  preserveHostHeader?: boolean;
  skipHttpsHostnameValidation?: boolean;
  enabled?: boolean;
  customReverseProxyJson?: string | null;
  customPreHandlersJson?: string | null;
  authentik?: ProxyHostAuthentikInput | null;
  loadBalancer?: LoadBalancerInput | null;
  dnsResolver?: DnsResolverInput | null;
  upstreamDnsResolution?: UpstreamDnsResolutionInput | null;
  geoblock?: GeoBlockSettings | null;
  geoblockMode?: GeoBlockMode;
  waf?: WafHostConfig | null;
  mtls?: MtlsConfig | null;
  cpmForwardAuth?: CpmForwardAuthInput | null;
  redirects?: RedirectRule[] | null;
  rewrite?: RewriteConfig | null;
  locationRules?: LocationRule[] | null;
  pathAllows?: PathAllowRule[] | null;
  pathBlocks?: PathBlockRule[] | null;
  pathRewrites?: PathRewriteRule[] | null;
  errorPages?: ErrorPageRule[] | null;
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
    normalized.auth_endpoint = authEndpoint.replace(/\{[^}]*\}/g, ""); // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
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
    const paths = meta.protected_paths.map((path) => path?.trim().replace(/\{[^}]*\}/g, "")).filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      normalized.protected_paths = paths;
    }
  }

  if (Array.isArray(meta.excluded_paths)) {
    const paths = meta.excluded_paths.map((path) => path?.trim().replace(/\{[^}]*\}/g, "")).filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      normalized.excluded_paths = paths;
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

function sanitizeUpstreamDnsResolutionMeta(
  meta: UpstreamDnsResolutionMeta | undefined
): UpstreamDnsResolutionMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const normalized: UpstreamDnsResolutionMeta = {};
  if (meta.enabled !== undefined) {
    normalized.enabled = Boolean(meta.enabled);
  }

  if (meta.family && VALID_UPSTREAM_DNS_FAMILIES.includes(meta.family)) {
    normalized.family = meta.family;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function sanitizeCpmForwardAuthMeta(meta: CpmForwardAuthMeta | undefined): CpmForwardAuthMeta | undefined {
  if (!meta) return undefined;
  const normalized: CpmForwardAuthMeta = {};
  if (meta.enabled !== undefined) {
    normalized.enabled = Boolean(meta.enabled);
  }
  if (Array.isArray(meta.protected_paths)) {
    const paths = meta.protected_paths.map((p) => p?.trim().replace(/\{[^}]*\}/g, "")).filter((p): p is string => Boolean(p)); // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
    if (paths.length > 0) {
      normalized.protected_paths = paths;
    }
  }
  if (Array.isArray(meta.excluded_paths)) {
    const paths = meta.excluded_paths.map((p) => p?.trim().replace(/\{[^}]*\}/g, "")).filter((p): p is string => Boolean(p)); // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
    if (paths.length > 0) {
      normalized.excluded_paths = paths;
    }
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

  const upstreamDnsResolution = sanitizeUpstreamDnsResolutionMeta(meta.upstream_dns_resolution);
  if (upstreamDnsResolution) {
    normalized.upstream_dns_resolution = upstreamDnsResolution;
  }

  if (meta.geoblock) {
    normalized.geoblock = meta.geoblock;
  }

  if (meta.geoblock_mode) {
    normalized.geoblock_mode = meta.geoblock_mode;
  }

  if (meta.waf) {
    normalized.waf = meta.waf;
  }

  if (meta.mtls) {
    const mtls = sanitizeMtlsMeta(meta.mtls);
    if (mtls) {
      normalized.mtls = mtls;
    }
  }

  if (meta.cpm_forward_auth) {
    const cfa = sanitizeCpmForwardAuthMeta(meta.cpm_forward_auth);
    if (cfa) {
      normalized.cpm_forward_auth = cfa;
    }
  }

  if (meta.redirects && meta.redirects.length > 0) {
    normalized.redirects = meta.redirects;
  }
  if (meta.rewrite?.path_prefix) {
    normalized.rewrite = meta.rewrite;
  }

  if (meta.location_rules && meta.location_rules.length > 0) {
    normalized.location_rules = meta.location_rules;
  }

  if (meta.path_allows && meta.path_allows.length > 0) {
    normalized.path_allows = meta.path_allows;
  }

  if (meta.path_blocks && meta.path_blocks.length > 0) {
    normalized.path_blocks = meta.path_blocks;
  }

  if (meta.path_rewrites && meta.path_rewrites.length > 0) {
    normalized.path_rewrites = meta.path_rewrites;
  }

  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function sanitizeRedirectRules(value: unknown): RedirectRule[] {
  if (!Array.isArray(value)) return [];
  const valid: RedirectRule[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.from === "string" && item.from.trim() &&
      typeof item.to === "string" && item.to.trim() &&
      [301, 302, 307, 308].includes(item.status)
    ) {
      // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
      valid.push({ from: item.from.trim().replace(/\{[^}]*\}/g, ""), to: item.to.trim().replace(/\{[^}]*\}/g, ""), status: item.status });
    }
  }
  return valid;
}

function sanitizeRewriteConfig(value: unknown): RewriteConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const prefix = typeof v.path_prefix === "string" ? v.path_prefix.trim() : null;
  if (!prefix) return null;
  return { path_prefix: prefix };
}

function sanitizePathAllows(value: unknown): PathAllowRule[] {
  if (!Array.isArray(value)) return [];
  const valid: PathAllowRule[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && typeof item.path === "string" && item.path.trim()) {
      // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
      const path = item.path.trim().replace(/\{[^}]*\}/g, "");
      if (path) {
        valid.push({ path });
      }
    }
  }
  return valid;
}

function sanitizePathBlocks(value: unknown): PathBlockRule[] {
  if (!Array.isArray(value)) return [];
  const valid: PathBlockRule[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.path === "string" && item.path.trim() &&
      typeof item.status === "number" &&
      (PATH_BLOCK_STATUS_CODES as readonly number[]).includes(item.status)
    ) {
      const rule: PathBlockRule = {
        // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
        path: item.path.trim().replace(/\{[^}]*\}/g, ""),
        status: item.status as PathBlockStatusCode,
      };
      if (typeof item.body === "string" && item.body.length > 0) {
        rule.body = item.body.slice(0, 4096);
      }
      if (rule.path) {
        valid.push(rule);
      }
    }
  }
  return valid;
}

function sanitizePathRewrites(value: unknown): PathRewriteRule[] {
  if (!Array.isArray(value)) return [];
  const valid: PathRewriteRule[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.from === "string" && item.from.trim() &&
      typeof item.to === "string" && item.to.trim()
    ) {
      // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
      const from = item.from.trim().replace(/\{[^}]*\}/g, "");
      // codeql[js/polynomial-redos] false positive: [^}]* is linear, no backtracking ambiguity
      const to = item.to.trim().replace(/\{[^}]*\}/g, "");
      if (from && to) {
        valid.push({ from, to });
      }
    }
  }
  return valid;
}

const ERROR_PAGE_BODY_MAX = 65536;
const ERROR_PAGE_CONTENT_TYPE_MAX = 128;

export function sanitizeErrorPageRules(value: unknown): ErrorPageRule[] {
  if (!Array.isArray(value)) return [];
  const valid: ErrorPageRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const body = typeof item.body === "string" ? item.body : "";
    if (!body) continue; // a rule with no body would do nothing
    const rawStatuses: unknown[] = Array.isArray(item.statuses) ? item.statuses : [];
    const statuses = [...new Set(
      rawStatuses.filter((s): s is number =>
        typeof s === "number" && Number.isInteger(s) && s >= 400 && s <= 599)
    )];
    const rule: ErrorPageRule = { statuses, body: body.slice(0, ERROR_PAGE_BODY_MAX) };
    if (typeof item.contentType === "string") {
      // Strip CR/LF to prevent response header injection.
      const ct = item.contentType.replace(/[\r\n]/g, "").trim().slice(0, ERROR_PAGE_CONTENT_TYPE_MAX);
      if (ct) rule.contentType = ct;
    }
    valid.push(rule);
  }
  return valid;
}

function sanitizeLocationRules(value: unknown): LocationRule[] {
  if (!Array.isArray(value)) return [];
  const valid: LocationRule[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.path === "string" && item.path.trim() &&
      Array.isArray(item.upstreams)
    ) {
      const upstreams = (item.upstreams as unknown[])
        .filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
        .map((u) => u.trim());
      if (upstreams.length > 0) {
        valid.push({ path: item.path.trim(), upstreams });
      }
    }
  }
  return valid;
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
      dns_resolver: sanitizeDnsResolverMeta(parsed.dns_resolver),
      upstream_dns_resolution: sanitizeUpstreamDnsResolutionMeta(parsed.upstream_dns_resolution),
      geoblock: parsed.geoblock,
      geoblock_mode: parsed.geoblock_mode,
      waf: parsed.waf,
      mtls: parsed.mtls,
      cpm_forward_auth: sanitizeCpmForwardAuthMeta(parsed.cpm_forward_auth),
      redirects: sanitizeRedirectRules(parsed.redirects),
      rewrite: sanitizeRewriteConfig(parsed.rewrite) ?? undefined,
      location_rules: sanitizeLocationRules(parsed.location_rules),
      path_allows: sanitizePathAllows(parsed.path_allows),
      path_blocks: sanitizePathBlocks(parsed.path_blocks),
      path_rewrites: sanitizePathRewrites(parsed.path_rewrites),
      error_pages: sanitizeErrorPageRules(parsed.error_pages),
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

  if (input.excludedPaths !== undefined) {
    const paths = (input.excludedPaths ?? [])
      .map((path) => path?.trim())
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      next.excluded_paths = paths;
    } else {
      delete next.excluded_paths;
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

function normalizeUpstreamDnsResolutionInput(
  input: UpstreamDnsResolutionInput | null | undefined,
  existing: UpstreamDnsResolutionMeta | undefined
): UpstreamDnsResolutionMeta | undefined {
  if (input === undefined) {
    return existing;
  }
  if (input === null) {
    return undefined;
  }

  const next: UpstreamDnsResolutionMeta = { ...(existing ?? {}) };

  if (input.enabled !== undefined) {
    if (input.enabled === null) {
      delete next.enabled;
    } else {
      next.enabled = Boolean(input.enabled);
    }
  }

  if (input.family !== undefined) {
    if (input.family && VALID_UPSTREAM_DNS_FAMILIES.includes(input.family)) {
      next.family = input.family;
    } else {
      delete next.family;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildMeta(existing: ProxyHostMeta, input: Partial<ProxyHostInput>): string | null {
  const next: ProxyHostMeta = { ...existing };

  if (input.customReverseProxyJson !== undefined) {
    const reverse = normalizeMetaValue(input.customReverseProxyJson ?? null);
    if (reverse) {
      next.custom_reverse_proxy_json = reverse;
    } else {
      delete next.custom_reverse_proxy_json;
    }
  }

  if (input.customPreHandlersJson !== undefined) {
    const pre = normalizeMetaValue(input.customPreHandlersJson ?? null);
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

  if (input.loadBalancer !== undefined) {
    const loadBalancer = normalizeLoadBalancerInput(input.loadBalancer, existing.load_balancer);
    if (loadBalancer) {
      next.load_balancer = loadBalancer;
    } else {
      delete next.load_balancer;
    }
  }

  if (input.dnsResolver !== undefined) {
    const dnsResolver = normalizeDnsResolverInput(input.dnsResolver, existing.dns_resolver);
    if (dnsResolver) {
      next.dns_resolver = dnsResolver;
    } else {
      delete next.dns_resolver;
    }
  }

  if (input.upstreamDnsResolution !== undefined) {
    const upstreamDnsResolution = normalizeUpstreamDnsResolutionInput(
      input.upstreamDnsResolution,
      existing.upstream_dns_resolution
    );
    if (upstreamDnsResolution) {
      next.upstream_dns_resolution = upstreamDnsResolution;
    } else {
      delete next.upstream_dns_resolution;
    }
  }

  if (input.geoblock !== undefined) {
    const geoblockMeta = dehydrateGeoBlock(input.geoblock ?? null);
    if (geoblockMeta) {
      next.geoblock = geoblockMeta;
    } else {
      delete next.geoblock;
      delete next.geoblock_mode;
    }
  }

  if (input.geoblockMode !== undefined) {
    next.geoblock_mode = input.geoblockMode;
  }

  if (input.waf !== undefined) {
    if (input.waf) {
      next.waf = input.waf;
    } else {
      delete next.waf;
    }
  }

  if (input.mtls !== undefined) {
    if (input.mtls && input.mtls.enabled) {
      const mtls = sanitizeMtlsMeta(input.mtls);
      if (mtls) {
        next.mtls = mtls;
      }
    } else {
      delete next.mtls;
    }
  }

  if (input.cpmForwardAuth !== undefined) {
    if (input.cpmForwardAuth && input.cpmForwardAuth.enabled) {
      const cfa: CpmForwardAuthMeta = { enabled: true };
      if (input.cpmForwardAuth.protected_paths && input.cpmForwardAuth.protected_paths.length > 0) {
        cfa.protected_paths = input.cpmForwardAuth.protected_paths;
      }
      if (input.cpmForwardAuth.excluded_paths && input.cpmForwardAuth.excluded_paths.length > 0) {
        cfa.excluded_paths = input.cpmForwardAuth.excluded_paths;
      }
      next.cpm_forward_auth = cfa;
    } else {
      delete next.cpm_forward_auth;
    }
  }

  if (input.redirects !== undefined) {
    const rules = sanitizeRedirectRules(input.redirects ?? []);
    if (rules.length > 0) {
      next.redirects = rules;
    } else {
      delete next.redirects;
    }
  }

  if (input.rewrite !== undefined) {
    const rw = sanitizeRewriteConfig(input.rewrite);
    if (rw) {
      next.rewrite = rw;
    } else {
      delete next.rewrite;
    }
  }

  if (input.locationRules !== undefined) {
    const rules = sanitizeLocationRules(input.locationRules ?? []);
    if (rules.length > 0) {
      next.location_rules = rules;
    } else {
      delete next.location_rules;
    }
  }

  if (input.pathAllows !== undefined) {
    const rules = sanitizePathAllows(input.pathAllows ?? []);
    if (rules.length > 0) {
      next.path_allows = rules;
    } else {
      delete next.path_allows;
    }
  }

  if (input.pathBlocks !== undefined) {
    const rules = sanitizePathBlocks(input.pathBlocks ?? []);
    if (rules.length > 0) {
      next.path_blocks = rules;
    } else {
      delete next.path_blocks;
    }
  }

  if (input.pathRewrites !== undefined) {
    const rules = sanitizePathRewrites(input.pathRewrites ?? []);
    if (rules.length > 0) {
      next.path_rewrites = rules;
    } else {
      delete next.path_rewrites;
    }
  }

  if (input.errorPages !== undefined) {
    const rules = sanitizeErrorPageRules(input.errorPages ?? []);
    if (rules.length > 0) {
      next.error_pages = rules;
    } else {
      delete next.error_pages;
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
  const excludedPaths =
    Array.isArray(meta.excluded_paths) && meta.excluded_paths.length > 0 ? meta.excluded_paths : null;

  return {
    enabled,
    outpostDomain,
    outpostUpstream,
    authEndpoint,
    copyHeaders,
    trustedProxies,
    setOutpostHostHeader,
    protectedPaths,
    excludedPaths
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
  if (config.excludedPaths && config.excludedPaths.length > 0) {
    meta.excluded_paths = [...config.excludedPaths];
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

function hydrateUpstreamDnsResolution(meta: UpstreamDnsResolutionMeta | undefined): UpstreamDnsResolutionConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = meta.enabled === undefined ? null : Boolean(meta.enabled);
  const family = meta.family && VALID_UPSTREAM_DNS_FAMILIES.includes(meta.family) ? meta.family : null;

  return {
    enabled,
    family
  };
}

function dehydrateUpstreamDnsResolution(
  config: UpstreamDnsResolutionConfig | null
): UpstreamDnsResolutionMeta | undefined {
  if (!config) {
    return undefined;
  }

  const meta: UpstreamDnsResolutionMeta = {};
  if (config.enabled !== null) {
    meta.enabled = Boolean(config.enabled);
  }
  if (config.family && VALID_UPSTREAM_DNS_FAMILIES.includes(config.family)) {
    meta.family = config.family;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function hydrateGeoBlock(meta: GeoBlockSettings | undefined): GeoBlockSettings | null {
  return meta ?? null;
}

function dehydrateGeoBlock(geoblock: GeoBlockSettings | null): GeoBlockSettings | undefined {
  if (!geoblock) return undefined;
  return geoblock;
}

function parseProxyHost(row: ProxyHostRow): ProxyHost {
  const meta = parseMeta(row.meta ?? null);
  return {
    id: row.id,
    name: row.name,
    domains: JSON.parse(row.domains),
    upstreams: JSON.parse(row.upstreams),
    certificateId: row.certificateId ?? null,
    accessListId: row.accessListId ?? null,
    sslForced: row.sslForced,
    hstsEnabled: row.hstsEnabled,
    hstsSubdomains: row.hstsSubdomains,
    allowWebsocket: row.allowWebsocket,
    preserveHostHeader: row.preserveHostHeader,
    skipHttpsHostnameValidation: row.skipHttpsHostnameValidation,
    enabled: row.enabled,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    customReverseProxyJson: meta.custom_reverse_proxy_json ?? null,
    customPreHandlersJson: meta.custom_pre_handlers_json ?? null,
    authentik: hydrateAuthentik(meta.authentik),
    loadBalancer: hydrateLoadBalancer(meta.load_balancer),
    dnsResolver: hydrateDnsResolver(meta.dns_resolver),
    upstreamDnsResolution: hydrateUpstreamDnsResolution(meta.upstream_dns_resolution),
    geoblock: hydrateGeoBlock(meta.geoblock),
    geoblockMode: meta.geoblock_mode ?? "merge",
    waf: meta.waf ?? null,
    mtls: meta.mtls ?? null,
    cpmForwardAuth: meta.cpm_forward_auth?.enabled
      ? { enabled: true, protected_paths: meta.cpm_forward_auth.protected_paths ?? null, excluded_paths: meta.cpm_forward_auth.excluded_paths ?? null }
      : null,
    redirects: meta.redirects ?? [],
    rewrite: meta.rewrite ?? null,
    locationRules: meta.location_rules ?? [],
    pathAllows: meta.path_allows ?? [],
    pathBlocks: meta.path_blocks ?? [],
    pathRewrites: meta.path_rewrites ?? [],
    errorPages: meta.error_pages ?? [],
  };
}

export async function listProxyHosts(): Promise<ProxyHost[]> {
  const hosts = await db.select().from(proxyHosts).orderBy(desc(proxyHosts.createdAt));
  return hosts.map(parseProxyHost);
}

export async function countProxyHosts(search?: string): Promise<number> {
  const where = search
    ? or(
        like(proxyHosts.name, `%${search}%`),
        like(proxyHosts.domains, `%${search}%`),
        like(proxyHosts.upstreams, `%${search}%`)
      )
    : undefined;
  const [row] = await db.select({ value: count() }).from(proxyHosts).where(where);
  return row?.value ?? 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROXY_HOST_SORT_COLUMNS: Record<string, any> = {
  name: proxyHosts.name,
  domains: proxyHosts.domains,
  upstreams: proxyHosts.upstreams,
  enabled: proxyHosts.enabled,
  createdAt: proxyHosts.createdAt,
};

export async function listProxyHostsPaginated(
  limit: number,
  offset: number,
  search?: string,
  sortBy?: string,
  sortDir?: "asc" | "desc"
): Promise<ProxyHost[]> {
  const where = search
    ? or(
        like(proxyHosts.name, `%${search}%`),
        like(proxyHosts.domains, `%${search}%`),
        like(proxyHosts.upstreams, `%${search}%`)
      )
    : undefined;
  const col = (sortBy && PROXY_HOST_SORT_COLUMNS[sortBy]) || proxyHosts.createdAt;
  const dir = sortDir === "asc" ? asc : desc;
  const hosts = await db
    .select()
    .from(proxyHosts)
    .where(where)
    .orderBy(dir(col))
    .limit(limit)
    .offset(offset);
  return hosts.map(parseProxyHost);
}

export async function createProxyHost(input: ProxyHostInput, actorUserId: number) {
  const domains = normalizeProxyHostDomains(input.domains ?? []);

  if (!input.upstreams || input.upstreams.length === 0) {
    throw new Error("At least one upstream must be specified");
  }
  input.upstreams.forEach(validateUpstreamProtocol);

  const now = nowIso();
  const meta = buildMeta({}, input);
  const [record] = await db
    .insert(proxyHosts)
    .values({
      name: input.name.trim(),
      domains: JSON.stringify(domains),
      upstreams: JSON.stringify(Array.from(new Set(input.upstreams.map((u) => u.trim())))),
      certificateId: input.certificateId ?? null,
      accessListId: input.accessListId ?? null,
      ownerUserId: actorUserId,
      sslForced: input.sslForced ?? true,
      hstsEnabled: input.hstsEnabled ?? true,
      hstsSubdomains: input.hstsSubdomains ?? false,
      allowWebsocket: input.allowWebsocket ?? true,
      preserveHostHeader: input.preserveHostHeader ?? true,
      meta,
      skipHttpsHostnameValidation: input.skipHttpsHostnameValidation ?? false,
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

  const domains = JSON.stringify(
    input.domains ? normalizeProxyHostDomains(input.domains) : existing.domains
  );
  if (input.upstreams) {
    input.upstreams.forEach(validateUpstreamProtocol);
  }
  const upstreams = input.upstreams ? JSON.stringify(Array.from(new Set(input.upstreams))) : JSON.stringify(existing.upstreams);
  const existingMeta: ProxyHostMeta = {
    custom_reverse_proxy_json: existing.customReverseProxyJson ?? undefined,
    custom_pre_handlers_json: existing.customPreHandlersJson ?? undefined,
    authentik: dehydrateAuthentik(existing.authentik),
    load_balancer: dehydrateLoadBalancer(existing.loadBalancer),
    dns_resolver: dehydrateDnsResolver(existing.dnsResolver),
    upstream_dns_resolution: dehydrateUpstreamDnsResolution(existing.upstreamDnsResolution),
    geoblock: dehydrateGeoBlock(existing.geoblock),
    ...(existing.geoblockMode !== "merge" ? { geoblock_mode: existing.geoblockMode } : {}),
    ...(existing.waf ? { waf: existing.waf } : {}),
    ...(existing.mtls ? { mtls: existing.mtls } : {}),
    ...(existing.cpmForwardAuth?.enabled ? {
      cpm_forward_auth: {
        enabled: true,
        ...(existing.cpmForwardAuth.protected_paths ? { protected_paths: existing.cpmForwardAuth.protected_paths } : {}),
        ...(existing.cpmForwardAuth.excluded_paths ? { excluded_paths: existing.cpmForwardAuth.excluded_paths } : {})
      }
    } : {}),
    ...(existing.redirects && existing.redirects.length > 0 ? { redirects: existing.redirects } : {}),
    ...(existing.rewrite ? { rewrite: existing.rewrite } : {}),
    ...(existing.locationRules && existing.locationRules.length > 0 ? { location_rules: existing.locationRules } : {}),
    ...(existing.pathAllows && existing.pathAllows.length > 0 ? { path_allows: existing.pathAllows } : {}),
    ...(existing.pathBlocks && existing.pathBlocks.length > 0 ? { path_blocks: existing.pathBlocks } : {}),
    ...(existing.pathRewrites && existing.pathRewrites.length > 0 ? { path_rewrites: existing.pathRewrites } : {}),
    ...(existing.errorPages && existing.errorPages.length > 0 ? { error_pages: existing.errorPages } : {}),
  };
  const meta = buildMeta(existingMeta, input);

  const now = nowIso();
  await db
    .update(proxyHosts)
    .set({
      name: input.name ?? existing.name,
      domains,
      upstreams,
      certificateId: input.certificateId !== undefined ? input.certificateId : existing.certificateId,
      accessListId: input.accessListId !== undefined ? input.accessListId : existing.accessListId,
      sslForced: input.sslForced ?? existing.sslForced,
      hstsEnabled: input.hstsEnabled ?? existing.hstsEnabled,
      hstsSubdomains: input.hstsSubdomains ?? existing.hstsSubdomains,
      allowWebsocket: input.allowWebsocket ?? existing.allowWebsocket,
      preserveHostHeader: input.preserveHostHeader ?? existing.preserveHostHeader,
      meta,
      skipHttpsHostnameValidation: input.skipHttpsHostnameValidation ?? existing.skipHttpsHostnameValidation,
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
