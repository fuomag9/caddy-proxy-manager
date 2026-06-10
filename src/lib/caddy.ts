import { mkdirSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import crypto from "node:crypto";
import {
  expandPrivateRanges,
  isPlainObject,
  mergeDeep,
  parseJson,
  parseOptionalJson,
  parseCustomHandlers,
  formatDialAddress,
  parseUpstreamTarget,
  toDurationMs,
} from "./caddy-utils";
import {
  groupHostPatternsByPriority,
  sortAutomationPoliciesBySubjectPriority,
  sortRoutesByHostPriority,
  sortTlsPoliciesBySniPriority,
} from "./host-pattern-priority";
import http from "node:http";
import https from "node:https";
import db, { nowIso } from "./db";
import { eq, isNull } from "drizzle-orm";
import { config } from "./config";
import {
  getGeneralSettings,
  getMetricsSettings,
  getLoggingSettings,
  getDnsSettings,
  getDnsProviderSettings,
  getUpstreamDnsResolutionSettings,
  getGeoBlockSettings,
  getWafSettings,
  getErrorPagesSettings,
  setSetting,
  type DnsSettings,
  type UpstreamDnsAddressFamily,
  type UpstreamDnsResolutionSettings,
  type GeoBlockSettings,
  type WafSettings
} from "./settings";
import { buildDnsChallengeConfig, type DnsProviderCredentials } from "./dns-providers";
import { syncInstances } from "./instance-sync";
import {
  accessListEntries,
  certificates,
  caCertificates,
  issuedClientCertificates,
  proxyHosts,
  l4ProxyHosts
} from "./db/schema";
import { type GeoBlockMode, type WafHostConfig, type MtlsConfig, type RedirectRule, type RewriteConfig, type LocationRule, type PathAllowRule, type PathBlockRule, type PathRewriteRule, type ErrorPageRule } from "./models/proxy-hosts";
import { buildClientAuthentication, groupMtlsDomainsByCaSet, buildMtlsRbacSubroutes, buildFingerprintCelExpression, buildValidClientCertCelExpression, resolveAllowedFingerprints, type MtlsAccessRuleLike } from "./caddy-mtls";
import { buildRoleFingerprintMap, buildCertFingerprintMap, buildRoleCertIdMap } from "./models/mtls-roles";
import { getAccessRulesForHosts } from "./models/mtls-access-rules";
import { buildWafHandler, resolveEffectiveWaf } from "./caddy-waf";

const CERTS_DIR = process.env.CERTS_DIRECTORY || join(process.cwd(), "data", "certs");
mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });

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


type ProxyHostRow = {
  id: number;
  name: string;
  domains: string;
  upstreams: string;
  certificateId: number | null;
  accessListId: number | null;
  sslForced: number;
  hstsEnabled: number;
  hstsSubdomains: number;
  allowWebsocket: number;
  preserveHostHeader: number;
  skipHttpsHostnameValidation: number;
  meta: string | null;
  enabled: number;
};

type DnsResolverMeta = {
  enabled?: boolean;
  resolvers?: string[];
  fallbacks?: string[];
  timeout?: string;
};

type UpstreamDnsResolutionMeta = {
  enabled?: boolean;
  family?: UpstreamDnsAddressFamily;
};

type CpmForwardAuthMeta = {
  enabled?: boolean;
  protected_paths?: string[];
  excluded_paths?: string[];
};

type MtlsMeta = {
  enabled?: boolean;
  trusted_client_cert_ids?: number[];
  trusted_role_ids?: number[];
  protected_paths?: string[];
  excluded_paths?: string[];
  ca_certificate_ids?: number[];
};

type ProxyHostMeta = {
  custom_reverse_proxy_json?: string;
  custom_pre_handlers_json?: string;
  authentik?: ProxyHostAuthentikMeta;
  cpm_forward_auth?: CpmForwardAuthMeta;
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
  upstream_dns_resolution?: UpstreamDnsResolutionMeta;
  geoblock?: GeoBlockSettings;
  geoblock_mode?: GeoBlockMode;
  waf?: WafHostConfig;
  mtls?: MtlsMeta;
  redirects?: RedirectRule[];
  rewrite?: RewriteConfig;
  location_rules?: LocationRule[];
  path_allows?: PathAllowRule[];
  path_blocks?: PathBlockRule[];
  path_rewrites?: PathRewriteRule[];
  error_pages?: ErrorPageRule[];
};

type L4Meta = {
  load_balancer?: LoadBalancerMeta;
  dns_resolver?: DnsResolverMeta;
  upstream_dns_resolution?: UpstreamDnsResolutionMeta;
  geoblock?: GeoBlockSettings;
  geoblock_mode?: GeoBlockMode;
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

type AuthentikRouteConfig = {
  enabled: boolean;
  outpostDomain: string;
  outpostUpstream: string;
  authEndpoint: string;
  copyHeaders: string[];
  trustedProxies: string[];
  setOutpostHostHeader: boolean;
  protectedPaths: string[] | null;
  excludedPaths: string[] | null;
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

type LoadBalancerRouteConfig = {
  enabled: boolean;
  policy: string;
  policyHeaderField: string | null;
  policyCookieName: string | null;
  policyCookieSecret: string | null;
  tryDuration: string | null;
  tryInterval: string | null;
  retries: number | null;
  activeHealthCheck: {
    enabled: boolean;
    uri: string | null;
    port: number | null;
    interval: string | null;
    timeout: string | null;
    status: number | null;
    body: string | null;
  } | null;
  passiveHealthCheck: {
    enabled: boolean;
    failDuration: string | null;
    maxFails: number | null;
    unhealthyStatus: number[] | null;
    unhealthyLatency: string | null;
  } | null;
};

type AccessListEntryRow = {
  accessListId: number;
  username: string;
  passwordHash: string;
};

type CertificateRow = {
  id: number;
  name: string;
  type: string;
  domainNames: string;
  certificatePem: string | null;
  privateKeyPem: string | null;
  autoRenew: number;
  providerOptions: string | null;
};

type CaddyHttpRoute = Record<string, unknown>;

type CertificateUsage = {
  certificate: CertificateRow;
  domains: Set<string>;
};

const VALID_UPSTREAM_DNS_FAMILIES: UpstreamDnsAddressFamily[] = ["ipv6", "ipv4", "both"];

type UpstreamDnsResolutionRouteConfig = {
  enabled: boolean | null;
  family: UpstreamDnsAddressFamily | null;
};

type EffectiveUpstreamDnsResolution = {
  enabled: boolean;
  family: UpstreamDnsAddressFamily;
};

function parseUpstreamDnsResolutionConfig(
  meta: UpstreamDnsResolutionMeta | undefined | null
): UpstreamDnsResolutionRouteConfig | null {
  if (!meta) {
    return null;
  }

  const enabled = typeof meta.enabled === "boolean" ? meta.enabled : null;
  const family = meta.family && VALID_UPSTREAM_DNS_FAMILIES.includes(meta.family) ? meta.family : null;

  if (enabled === null && family === null) {
    return null;
  }

  return {
    enabled,
    family
  };
}

function resolveEffectiveUpstreamDnsResolution(
  globalSetting: UpstreamDnsResolutionSettings | null,
  hostSetting: UpstreamDnsResolutionRouteConfig | null
): EffectiveUpstreamDnsResolution {
  const globalFamily = globalSetting?.family && VALID_UPSTREAM_DNS_FAMILIES.includes(globalSetting.family)
    ? globalSetting.family
    : "both";
  const globalEnabled = Boolean(globalSetting?.enabled);

  return {
    enabled: hostSetting?.enabled ?? globalEnabled,
    family: hostSetting?.family ?? globalFamily
  };
}

function getLookupServers(dnsConfig: DnsResolverRouteConfig | null, globalDnsSettings: DnsSettings | null): string[] {
  if (dnsConfig && dnsConfig.enabled && dnsConfig.resolvers.length > 0) {
    const servers = [...dnsConfig.resolvers];
    if (dnsConfig.fallbacks && dnsConfig.fallbacks.length > 0) {
      servers.push(...dnsConfig.fallbacks);
    }
    return servers;
  }

  if (globalDnsSettings?.enabled && Array.isArray(globalDnsSettings.resolvers) && globalDnsSettings.resolvers.length > 0) {
    const servers = [...globalDnsSettings.resolvers];
    if (Array.isArray(globalDnsSettings.fallbacks) && globalDnsSettings.fallbacks.length > 0) {
      servers.push(...globalDnsSettings.fallbacks);
    }
    return servers;
  }

  return [];
}

function getLookupTimeoutMs(dnsConfig: DnsResolverRouteConfig | null, globalDnsSettings: DnsSettings | null): number | null {
  const hostTimeout = toDurationMs(dnsConfig?.timeout ?? null);
  if (hostTimeout !== null) {
    return hostTimeout;
  }

  if (globalDnsSettings?.enabled) {
    const globalTimeout = toDurationMs(globalDnsSettings.timeout ?? null);
    if (globalTimeout !== null) {
      return globalTimeout;
    }
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | null, timeoutLabel: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveHostnameAddresses(
  resolver: Resolver,
  hostname: string,
  family: UpstreamDnsAddressFamily,
  timeoutMs: number | null
): Promise<string[]> {
  const errors: string[] = [];
  const resolved: string[] = [];
  const seen = new Set<string>();

  const resolve6 = async () => {
    try {
      return await withTimeout(resolver.resolve6(hostname), timeoutMs, `AAAA lookup for ${hostname}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  };

  const resolve4 = async () => {
    try {
      return await withTimeout(resolver.resolve4(hostname), timeoutMs, `A lookup for ${hostname}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  };

  const pushUnique = (addresses: string[]) => {
    for (const address of addresses) {
      if (!seen.has(address)) {
        seen.add(address);
        resolved.push(address);
      }
    }
  };

  if (family === "ipv6") {
    pushUnique(await resolve6());
  } else if (family === "ipv4") {
    pushUnique(await resolve4());
  } else {
    pushUnique(await resolve6());
    pushUnique(await resolve4());
  }

  if (resolved.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return resolved;
}

type ResolveUpstreamsResult = {
  upstreams: Array<{ dial: string }>;
  hasHttpsUpstream: boolean;
  httpsTlsServerName: string | null;
};

async function resolveUpstreamDials(
  row: ProxyHostRow,
  upstreams: string[],
  dnsConfig: DnsResolverRouteConfig | null,
  globalDnsSettings: DnsSettings | null,
  dnsResolution: EffectiveUpstreamDnsResolution
): Promise<ResolveUpstreamsResult> {
  const parsedTargets = upstreams.map(parseUpstreamTarget);
  const hasHttpsUpstream = parsedTargets.some((target) => target.scheme === "https");

  if (!dnsResolution.enabled) {
    return {
      upstreams: parsedTargets.map((target) => ({ dial: target.dial })),
      hasHttpsUpstream,
      httpsTlsServerName: null
    };
  }

  const httpsHostnames = Array.from(
    new Set(
      parsedTargets
        .filter((target) => target.scheme === "https" && target.host && target.port && isIP(target.host) === 0)
        .map((target) => target.host as string)
    )
  );
  const canResolveHttps = httpsHostnames.length <= 1;
  if (!canResolveHttps) {
    console.warn(
      `[caddy] Skipping DNS pinning for HTTPS upstreams on host "${row.name}" because multiple TLS server names are configured.`
    );
  }

  const resolver = new Resolver();
  const lookupServers = getLookupServers(dnsConfig, globalDnsSettings);
  if (lookupServers.length > 0) {
    try {
      resolver.setServers(lookupServers);
    } catch (error) {
      console.warn(`[caddy] Failed to set custom DNS servers for upstream pinning`, error);
    }
  }
  const timeoutMs = getLookupTimeoutMs(dnsConfig, globalDnsSettings);

  const dials: string[] = [];
  for (const target of parsedTargets) {
    if (!target.host || !target.port || isIP(target.host) !== 0) {
      dials.push(target.dial);
      continue;
    }

    if (target.scheme === "https" && !canResolveHttps) {
      dials.push(target.dial);
      continue;
    }

    try {
      const addresses = await resolveHostnameAddresses(resolver, target.host, dnsResolution.family, timeoutMs);
      if (addresses.length === 0) {
        dials.push(target.dial);
        continue;
      }
      for (const address of addresses) {
        dials.push(formatDialAddress(address, target.port));
      }
    } catch (error) {
      console.warn(
        `[caddy] Failed to resolve upstream "${target.original}" for host "${row.name}", falling back to hostname dial.`,
        error
      );
      dials.push(target.dial);
    }
  }

  const dedupedDials: Array<{ dial: string }> = [];
  const seen = new Set<string>();
  for (const dial of dials) {
    if (!seen.has(dial)) {
      seen.add(dial);
      dedupedDials.push({ dial });
    }
  }

  return {
    upstreams: dedupedDials,
    hasHttpsUpstream,
    httpsTlsServerName: canResolveHttps && httpsHostnames.length === 1 ? httpsHostnames[0] : null
  };
}

function collectCertificateUsage(rows: ProxyHostRow[], certificates: Map<number, CertificateRow>) {
  const usage = new Map<number, CertificateUsage>();
  const autoManagedDomains = new Set<string>();

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }

    const domains = parseJson<string[]>(row.domains, []).map((domain) => domain?.trim().toLowerCase());
    const filteredDomains = domains.filter((domain): domain is string => Boolean(domain));
    if (filteredDomains.length === 0) {
      continue;
    }

    // Handle auto-managed certificates (certificateId is null)
    if (!row.certificateId) {
      for (const domain of filteredDomains) {
        autoManagedDomains.add(domain);
      }
      continue;
    }

    const cert = certificates.get(row.certificateId);
    if (!cert) {
      continue;
    }

    if (!usage.has(cert.id)) {
      usage.set(cert.id, {
        certificate: cert,
        domains: new Set()
      });
    }

    const entry = usage.get(cert.id)!;
    for (const domain of filteredDomains) {
      entry.domains.add(domain);
    }
  }

  return { usage, autoManagedDomains };
}

function mergeGeoBlockSettings(
  global: GeoBlockSettings,
  host: GeoBlockSettings
): GeoBlockSettings {
  return {
    enabled: host.enabled || global.enabled,
    block_countries: [...(global.block_countries ?? []), ...(host.block_countries ?? [])],
    block_continents: [...(global.block_continents ?? []), ...(host.block_continents ?? [])],
    block_asns: [...(global.block_asns ?? []), ...(host.block_asns ?? [])],
    block_cidrs: [...(global.block_cidrs ?? []), ...(host.block_cidrs ?? [])],
    block_ips: [...(global.block_ips ?? []), ...(host.block_ips ?? [])],
    allow_countries: [...(global.allow_countries ?? []), ...(host.allow_countries ?? [])],
    allow_continents: [...(global.allow_continents ?? []), ...(host.allow_continents ?? [])],
    allow_asns: [...(global.allow_asns ?? []), ...(host.allow_asns ?? [])],
    allow_cidrs: [...(global.allow_cidrs ?? []), ...(host.allow_cidrs ?? [])],
    allow_ips: [...(global.allow_ips ?? []), ...(host.allow_ips ?? [])],
    trusted_proxies: [...(global.trusted_proxies ?? []), ...(host.trusted_proxies ?? [])],
    // Host config wins for scalar fields
    fail_closed: host.fail_closed || global.fail_closed || false,
    response_status: host.response_status ?? global.response_status ?? 403,
    response_body: host.response_body ?? global.response_body ?? "Forbidden",
    response_headers: { ...(global.response_headers ?? {}), ...(host.response_headers ?? {}) },
    redirect_url: host.redirect_url ?? global.redirect_url ?? "",
  };
}

export function resolveEffectiveGeoBlock(
  global: GeoBlockSettings | null,
  host: { geoblock: GeoBlockSettings | null; geoblock_mode: GeoBlockMode }
): GeoBlockSettings | null {
  const hostConfig = host.geoblock;
  const globalConfig = global;

  // Neither configured or enabled
  if (!hostConfig?.enabled && !globalConfig?.enabled) return null;

  // Host override mode: use host config only
  if (hostConfig && host.geoblock_mode === "override") {
    return hostConfig.enabled ? hostConfig : null;
  }

  // Host merge mode: only enabled host config should alter global behavior.
  // A disabled host geoblock means "no per-host geoblock" in merge mode.
  if (hostConfig?.enabled && globalConfig) {
    return mergeGeoBlockSettings(globalConfig, hostConfig);
  }

  // Only one configured
  if (hostConfig?.enabled) return hostConfig;
  if (globalConfig?.enabled) return globalConfig;

  return null;
}

export function buildBlockerHandler(config: GeoBlockSettings): Record<string, unknown> {
  const handler: Record<string, unknown> = {
    handler: "blocker",
    geoip_db: "/usr/share/GeoIP/GeoLite2-Country.mmdb",
    asn_db: "/usr/share/GeoIP/GeoLite2-ASN.mmdb",
  };

  if (config.block_countries?.length) handler.block_countries = config.block_countries;
  if (config.block_continents?.length) handler.block_continents = config.block_continents;
  if (config.block_asns?.length) handler.block_asns = config.block_asns;
  if (config.block_cidrs?.length) handler.block_cidrs = config.block_cidrs;
  if (config.block_ips?.length) handler.block_ips = config.block_ips;

  if (config.allow_countries?.length) handler.allow_countries = config.allow_countries;
  if (config.allow_continents?.length) handler.allow_continents = config.allow_continents;
  if (config.allow_asns?.length) handler.allow_asns = config.allow_asns;
  if (config.allow_cidrs?.length) handler.allow_cidrs = config.allow_cidrs;
  if (config.allow_ips?.length) handler.allow_ips = config.allow_ips;

  if (config.trusted_proxies?.length) handler.trusted_proxies = expandPrivateRanges(config.trusted_proxies);
  if (config.fail_closed) handler.fail_closed = true;

  if (config.redirect_url) {
    handler.redirect_url = config.redirect_url;
  } else {
    if (config.response_status) handler.response_status = config.response_status;
    if (config.response_body) handler.response_body = config.response_body;
    if (config.response_headers && Object.keys(config.response_headers).length) {
      handler.response_headers = config.response_headers;
    }
  }

  return handler;
}

type BuildProxyRoutesOptions = {
  globalDnsSettings: DnsSettings | null;
  globalUpstreamDnsResolutionSettings: UpstreamDnsResolutionSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  globalWaf?: WafSettings | null;
  mtlsRbac?: {
    roleFingerprintMap: Map<number, Set<string>>;
    certFingerprintMap: Map<number, string>;
    accessRulesByHost: Map<number, MtlsAccessRuleLike[]>;
  };
};

export function buildLocationReverseProxy(
  rule: LocationRule,
  skipHttpsValidation: boolean,
  preserveHostHeader: boolean
): { safePath: string; reverseProxyHandler: Record<string, unknown> } {
  const parsedTargets = rule.upstreams.map(parseUpstreamTarget);
  const hasHttps = parsedTargets.some((t) => t.scheme === "https");

  // Sanitize path to prevent Caddy placeholder injection
  const safePath = rule.path.replace(/\{[^}]*\}/g, "");

  const reverseProxyHandler: Record<string, unknown> = {
    handler: "reverse_proxy",
    upstreams: parsedTargets.map((t) => ({ dial: t.dial })),
  };

  if (preserveHostHeader) {
    reverseProxyHandler.headers = {
      request: { set: { Host: ["{http.request.host}"] } },
    };
  }

  if (hasHttps) {
    reverseProxyHandler.transport = {
      protocol: "http",
      tls: skipHttpsValidation ? { insecure_skip_verify: true } : {},
    };
  }

  return { safePath, reverseProxyHandler };
}

// Builds a Caddy server-level error route (handle_errors equivalent) that serves a
// custom static response while preserving the original error status code. An empty
// `statuses` list matches every error; `hosts`, when set, scopes the route to a host.
export function buildErrorPageRoute(rule: ErrorPageRule, hosts?: string[]): CaddyHttpRoute {
  const matcher: Record<string, unknown> = {};
  if (hosts && hosts.length > 0) {
    matcher.host = hosts;
  }
  if (rule.statuses.length > 0) {
    // Mirrors Caddy's documented handle_errors form, e.g. {http.error.status_code} == 404
    matcher.expression = rule.statuses.map((s) => `{http.error.status_code} == ${s}`).join(" || ");
  }
  const route: CaddyHttpRoute = {
    handle: [
      {
        handler: "static_response",
        status_code: "{http.error.status_code}",
        body: rule.body,
        headers: { "Content-Type": [rule.contentType || "text/html; charset=utf-8"] },
      },
    ],
    terminal: true,
  };
  if (Object.keys(matcher).length > 0) {
    route.match = [matcher];
  }
  return route;
}

async function buildProxyRoutes(
  rows: ProxyHostRow[],
  accessAccounts: Map<number, AccessListEntryRow[]>,
  tlsReadyCertificates: Set<number>,
  options: BuildProxyRoutesOptions
): Promise<{ routes: CaddyHttpRoute[]; errorRoutes: CaddyHttpRoute[] }> {
  const routes: CaddyHttpRoute[] = [];
  const errorRoutes: CaddyHttpRoute[] = [];
  const validClientCertExpression = buildValidClientCertCelExpression();

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }

    // Allow hosts with certificateId = null (Caddy Auto) or with valid certificate IDs
    const isAutoManaged = !row.certificateId;
    const hasValidCertificate = row.certificateId && tlsReadyCertificates.has(row.certificateId);

    if (!isAutoManaged && !hasValidCertificate) {
      continue;
    }

    const domains = parseJson<string[]>(row.domains, []);
    if (domains.length === 0) {
      continue;
    }
    const domainGroups = groupHostPatternsByPriority(domains);

    // Require upstreams
    const upstreams = parseJson<string[]>(row.upstreams, []);
    if (upstreams.length === 0) {
      continue;
    }

    const handlers: Record<string, unknown>[] = [];
    const meta = parseJson<ProxyHostMeta>(row.meta, {});
    const authentik = parseAuthentikConfig(meta.authentik);
    const cpmForwardAuth = meta.cpm_forward_auth?.enabled ? meta.cpm_forward_auth : null;
    const hostRoutes: CaddyHttpRoute[] = [];

    const effectiveGeoBlock = resolveEffectiveGeoBlock(
      options.globalGeoBlock ?? null,
      { geoblock: meta.geoblock ?? null, geoblock_mode: meta.geoblock_mode ?? "merge" }
    );
    if (effectiveGeoBlock?.enabled) {
      handlers.unshift(buildBlockerHandler(effectiveGeoBlock));
    }

    const effectiveWaf = resolveEffectiveWaf(
      options.globalWaf ?? null,
      meta.waf
    );
    if (effectiveWaf?.enabled && effectiveWaf.mode !== 'Off') {
      handlers.unshift(buildWafHandler(effectiveWaf, Boolean(row.allowWebsocket)));
    }

    if (row.hstsEnabled) {
      const value = row.hstsSubdomains ? "max-age=63072000; includeSubDomains" : "max-age=63072000";
      handlers.push({
        handler: "headers",
        response: {
          set: {
            "Strict-Transport-Security": [value]
          }
        }
      });
    }

    if (row.sslForced) {
      for (const domainGroup of domainGroups) {
        hostRoutes.push({
          match: [
            {
              host: domainGroup,
              expression: '{http.request.scheme} == "http"'
            }
          ],
          handle: [
            {
              handler: "static_response",
              status_code: 308,
              headers: {
                Location: ["https://{http.request.host}{http.request.uri}"]
              }
            }
          ],
          terminal: true
        });
      }
    }

    // Path blocks (terminal static_response) and path rewrites (URI rewrite).
    //
    // Path Allows are not emitted as standalone routes — a terminal match with
    // an empty handle would stop the subroute without falling through to the
    // reverse_proxy, returning an empty 200. Instead, every allow pattern is
    // folded into each block's matcher as a `not` clause: a block matches when
    // the request path matches the block pattern AND does not match any allow
    // pattern. Allowed requests therefore skip every block and exit the
    // subroute naturally, continuing to the outer reverse_proxy. Allows do not
    // affect rewrites — those keep their original matchers.
    const pathAllows = meta.path_allows ?? [];
    const pathBlocks = meta.path_blocks ?? [];
    const pathRewrites = meta.path_rewrites ?? [];
    if (pathBlocks.length > 0 || pathRewrites.length > 0) {
      const allowPatterns = pathAllows
        .map((a) => a.path.replace(/\{[^}]*\}/g, ''))
        .filter((p) => p.length > 0);
      const pathRoutes: CaddyHttpRoute[] = [];
      for (const block of pathBlocks) {
        // Sanitize path to prevent Caddy placeholder injection
        const safePath = block.path.replace(/\{[^}]*\}/g, '');
        if (!safePath) continue;
        const handle: Record<string, unknown> = {
          handler: "static_response",
          status_code: block.status,
        };
        if (block.body) {
          handle.body = block.body;
        }
        const matcher: Record<string, unknown> = { path: [safePath] };
        if (allowPatterns.length > 0) {
          matcher.not = [{ path: allowPatterns }];
        }
        pathRoutes.push({
          match: [matcher],
          handle: [handle],
          terminal: true,
        });
      }
      for (const rw of pathRewrites) {
        const safeFrom = rw.from.replace(/\{[^}]*\}/g, '');
        const safeTo = rw.to.replace(/\{[^}]*\}/g, '');
        if (!safeFrom || !safeTo) continue;
        pathRoutes.push({
          match: [{ path: [safeFrom] }],
          handle: [{
            handler: "rewrite",
            uri: safeTo,
          }],
        });
      }
      if (pathRoutes.length > 0) {
        handlers.push({
          handler: "subroute",
          routes: pathRoutes,
        });
      }
    }

    // Structured redirects — emitted before auth so .well-known paths work without login
    if (meta.redirects && meta.redirects.length > 0) {
      const redirectRoutes = meta.redirects.map((rule) => ({
        match: [{ path: [rule.from] }],
        handle: [{
          handler: "static_response",
          status_code: rule.status,
          headers: { Location: [rule.to] },
        }],
      }));
      handlers.push({
        handler: "subroute",
        routes: redirectRoutes,
      });
    }

    if (row.accessListId) {
      const accounts = accessAccounts.get(row.accessListId) ?? [];
      if (accounts.length > 0) {
        handlers.push({
          handler: "authentication",
          providers: {
            http_basic: {
              accounts: accounts.map((entry) => ({
                username: entry.username,
                password: entry.passwordHash
              }))
            }
          }
        });
      }
    }

    const lbConfig = parseLoadBalancerConfig(meta.load_balancer);
    const dnsConfig = parseDnsResolverConfig(meta.dns_resolver);
    const hostDnsResolutionConfig = parseUpstreamDnsResolutionConfig(meta.upstream_dns_resolution);
    const effectiveDnsResolution = resolveEffectiveUpstreamDnsResolution(
      options.globalUpstreamDnsResolutionSettings,
      hostDnsResolutionConfig
    );
    const resolvedUpstreams = await resolveUpstreamDials(
      row,
      upstreams,
      dnsConfig,
      options.globalDnsSettings,
      effectiveDnsResolution
    );

    const reverseProxyHandler: Record<string, unknown> = {
      handler: "reverse_proxy",
      upstreams: resolvedUpstreams.upstreams
    };

    // Authentik outpost handler will be added later after protected paths
    let outpostRoute: CaddyHttpRoute | null = null;
    if (authentik) {
      // Parse the outpost upstream URL to extract host:port for Caddy's dial field
      let outpostDial: string;
      try {
        const url = new URL(authentik.outpostUpstream);
        const port = url.port || (url.protocol === "https:" ? "443" : "80");
        outpostDial = `${url.hostname}:${port}`;
      } catch {
        // If URL parsing fails, try to extract host:port from string
        outpostDial = authentik.outpostUpstream.replace(/^https?:\/\//, "").replace(/\/$/, "");
      }

      const outpostHandler: Record<string, unknown> = {
        handler: "reverse_proxy",
        upstreams: [
          {
            dial: outpostDial
          }
        ]
      };

      if (authentik.setOutpostHostHeader) {
        outpostHandler.headers = {
          request: {
            set: {
              Host: ["{http.reverse_proxy.upstream.host}"]
            }
          }
        };
      }

      outpostRoute = {
        match: [
          {
            // Sanitize outpostDomain to prevent path traversal and placeholder injection
            path: [`/${authentik.outpostDomain.replace(/\.\./g, '').replace(/\{[^}]*\}/g, '').replace(/\/+/g, '/')}/*`]
          }
        ],
        handle: [outpostHandler],
        terminal: true
      };
    }

    if (row.preserveHostHeader) {
      reverseProxyHandler.headers = {
        request: {
          set: {
            Host: ["{http.request.host}"]
          }
        }
      };
    }

    // Configure TLS transport for HTTPS upstreams
    if (resolvedUpstreams.hasHttpsUpstream) {
      const tlsTransport: Record<string, unknown> = row.skipHttpsHostnameValidation
        ? {
            insecure_skip_verify: true
          }
        : {};
      if (resolvedUpstreams.httpsTlsServerName) {
        tlsTransport.server_name = resolvedUpstreams.httpsTlsServerName;
      }

      reverseProxyHandler.transport = {
        protocol: "http",
        tls: tlsTransport
      };
    }

    // Configure load balancing and health checks
    if (lbConfig) {
      const loadBalancing = buildLoadBalancingConfig(lbConfig);
      if (loadBalancing) {
        reverseProxyHandler.load_balancing = loadBalancing;
      }
      const healthChecks = buildHealthChecksConfig(lbConfig);
      if (healthChecks) {
        reverseProxyHandler.health_checks = healthChecks;
      }
    }

    // Add transport-level DNS resolver config if enabled
    if (dnsConfig && dnsConfig.enabled && dnsConfig.resolvers.length > 0) {
      const resolverConfig = buildResolverConfig(dnsConfig);
      if (resolverConfig) {
        // Merge resolver into existing transport (preserving TLS settings for HTTPS upstreams)
        if (reverseProxyHandler.transport) {
          (reverseProxyHandler.transport as Record<string, unknown>).resolver = resolverConfig;
          if (dnsConfig.timeout) {
            (reverseProxyHandler.transport as Record<string, unknown>).dial_timeout = dnsConfig.timeout;
          }
        } else {
          // No existing transport, create one with resolver
          reverseProxyHandler.transport = {
            protocol: "http",
            resolver: resolverConfig,
            ...(dnsConfig.timeout ? { dial_timeout: dnsConfig.timeout } : {})
          };
        }
      }
    }

    // Security: This field allows admins to inject arbitrary Caddy reverse_proxy config.
    // This is intentional — admins have full control of the proxy configuration.
    // Prototype pollution is prevented by mergeDeep blocking __proto__/constructor/prototype.
    const customReverseProxy = parseOptionalJson(meta.custom_reverse_proxy_json);
    if (customReverseProxy) {
      if (isPlainObject(customReverseProxy)) {
        mergeDeep(reverseProxyHandler, customReverseProxy as Record<string, unknown>);
      } else {
        console.warn("Ignoring custom reverse proxy JSON because it is not an object", customReverseProxy);
      }
    }

    // Structured path prefix rewrite
    // Sanitize path_prefix to prevent Caddy placeholder injection
    if (meta.rewrite?.path_prefix) {
      const safePrefix = meta.rewrite.path_prefix.replace(/\{[^}]*\}/g, '');
      if (safePrefix) {
        handlers.push({
          handler: "rewrite",
          uri: `${safePrefix}{http.request.uri}`,
        });
      }
    }

    // Security: This field allows admins to inject arbitrary Caddy HTTP handlers.
    // This is intentional — admins can add any handler (file_server, rewrite, etc.)
    // before the reverse_proxy handler in the chain.
    const customHandlers = parseCustomHandlers(meta.custom_pre_handlers_json);
    if (customHandlers.length > 0) {
      handlers.push(...customHandlers);
    }

    if (authentik) {
      // Build handle_response routes for copying headers on 2xx status
      const handleResponseRoutes: Record<string, unknown>[] = [
        {
          handle: [{ handler: "vars" }]
        }
      ];

      // Add header copying for each configured header
      for (const headerName of authentik.copyHeaders) {
        handleResponseRoutes.push({
          handle: [
            {
              handler: "headers",
              request: {
                set: {
                  [headerName]: [`{http.reverse_proxy.header.${headerName}}`]
                }
              }
            } as Record<string, unknown>
          ],
          match: [
            {
              not: [
                {
                  vars: {
                    [`{http.reverse_proxy.header.${headerName}}`]: [""]
                  }
                }
              ]
            }
          ]
        });
      }

      // Create the forward auth reverse_proxy handler
      // Convert "private_ranges" to actual CIDR blocks for JSON config
      const trustedProxies = authentik.trustedProxies.includes("private_ranges")
        ? ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "fd00::/8", "::1/128"]
        : authentik.trustedProxies;

      // Parse the outpost upstream to extract host:port for dial
      // Remove http://, https://, and any trailing slashes
      let dialAddress = authentik.outpostUpstream.replace(/^https?:\/\//, "").replace(/\/$/, "");
      // Remove any path portion if accidentally included
      dialAddress = dialAddress.split("/")[0];

      const forwardAuthHandler: Record<string, unknown> = {
        handler: "reverse_proxy",
        upstreams: [
          {
            dial: dialAddress
          }
        ],
        rewrite: {
          method: "GET",
          uri: authentik.authEndpoint
        },
        headers: {
          request: {
            set: {
              "X-Forwarded-Method": ["{http.request.method}"],
              "X-Forwarded-Uri": ["{http.request.uri}"]
            }
          }
        },
        handle_response: [
          {
            match: {
              status_code: [2]
            },
            routes: handleResponseRoutes
          }
        ]
      };

      if (trustedProxies.length > 0) {
        forwardAuthHandler.trusted_proxies = trustedProxies;
      }

      // Path-based authentication support
      if (authentik.protectedPaths && authentik.protectedPaths.length > 0) {
        // Whitelist mode: only specified paths get auth
        for (const domainGroup of domainGroups) {
          // Create separate routes for each protected path
          for (const protectedPath of authentik.protectedPaths) {
            const protectedHandlers: Record<string, unknown>[] = [...handlers];
            const protectedReverseProxy = JSON.parse(JSON.stringify(reverseProxyHandler));

            protectedHandlers.push(forwardAuthHandler);
            protectedHandlers.push(protectedReverseProxy);

            hostRoutes.push({
              match: [
                {
                  host: domainGroup,
                  path: [protectedPath]
                }
              ],
              handle: protectedHandlers,
              terminal: true
            });
          }

          if (outpostRoute) {
            const outpostMatches = (outpostRoute.match as Array<Record<string, unknown>> | undefined) ?? [];
            hostRoutes.push({
              ...outpostRoute,
              match: outpostMatches.map((match) => ({
                ...match,
                host: domainGroup
              }))
            });
          }

          // Location rules are unprotected (no forwardAuthHandler), matching the catch-all
          // behavior when protected_paths is configured — only explicitly protected paths get auth.
          const locationRules = meta.location_rules ?? [];
          for (const rule of locationRules) {
            const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
              rule,
              Boolean(row.skipHttpsHostnameValidation),
              Boolean(row.preserveHostHeader)
            );
            if (!safePath) continue;
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath] }],
              handle: [...handlers, locationProxy],
              terminal: true,
            });
          }

          const unprotectedHandlers: Record<string, unknown>[] = [...handlers, reverseProxyHandler];

          hostRoutes.push({
            match: [{ host: domainGroup }],
            handle: unprotectedHandlers,
            terminal: true
          });
        }
      } else if (authentik.excludedPaths && authentik.excludedPaths.length > 0) {
        // Exclusion mode: protect everything EXCEPT specified paths
        const locationRules = meta.location_rules ?? [];
        for (const domainGroup of domainGroups) {
          if (outpostRoute) {
            const outpostMatches = (outpostRoute.match as Array<Record<string, unknown>> | undefined) ?? [];
            hostRoutes.push({
              ...outpostRoute,
              match: outpostMatches.map((match) => ({
                ...match,
                host: domainGroup
              }))
            });
          }

          // Create unprotected routes for each excluded path (before the catch-all)
          for (const excludedPath of authentik.excludedPaths) {
            hostRoutes.push({
              match: [{ host: domainGroup, path: [excludedPath] }],
              handle: [...handlers, JSON.parse(JSON.stringify(reverseProxyHandler))],
              terminal: true
            });
          }

          // Location rules get auth (same as full-site mode)
          for (const rule of locationRules) {
            const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
              rule,
              Boolean(row.skipHttpsHostnameValidation),
              Boolean(row.preserveHostHeader)
            );
            if (!safePath) continue;
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath] }],
              handle: [...handlers, forwardAuthHandler, locationProxy],
              terminal: true,
            });
          }

          // Catch-all with auth (everything not excluded)
          hostRoutes.push({
            match: [{ host: domainGroup }],
            handle: [...handlers, forwardAuthHandler, reverseProxyHandler],
            terminal: true
          });
        }
      } else {
        // Full-site mode: protect everything
        const locationRules = meta.location_rules ?? [];
        for (const domainGroup of domainGroups) {
          if (outpostRoute) {
            const outpostMatches = (outpostRoute.match as Array<Record<string, unknown>> | undefined) ?? [];
            hostRoutes.push({
              ...outpostRoute,
              match: outpostMatches.map((match) => ({
                ...match,
                host: domainGroup
              }))
            });
          }

          for (const rule of locationRules) {
            const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
              rule,
              Boolean(row.skipHttpsHostnameValidation),
              Boolean(row.preserveHostHeader)
            );
            if (!safePath) continue;
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath] }],
              handle: [...handlers, forwardAuthHandler, locationProxy],
              terminal: true,
            });
          }

          const routeHandlers: Record<string, unknown>[] = [...handlers, forwardAuthHandler, reverseProxyHandler];
          const route: CaddyHttpRoute = {
            match: [{ host: domainGroup }],
            handle: routeHandlers,
            terminal: true
          };
          hostRoutes.push(route);
        }
      }
    } else if (cpmForwardAuth) {
      // ── CPM Forward Auth ────────────────────────────────────────────
      // Uses CPM itself as the auth provider (replaces Authentik)
      const cpmDialAddress = getCpmDialAddress();
      if (cpmDialAddress) {
        const CPM_COPY_HEADERS = [
          "X-CPM-User",
          "X-CPM-Email",
          "X-CPM-Groups",
          "X-CPM-User-Id"
        ];

        // Security: strip any client-supplied CPM identity headers from the
        // inbound request before it ever reaches the upstream. These headers
        // are injected solely by CPM from the verify response; accepting them
        // from the client would let a caller spoof their identity / group
        // membership to upstream apps. This must run on EVERY route — protected,
        // unprotected catch-all, excluded, and location — because on routes
        // without the auth handler nothing else would remove them, and on
        // authenticated routes the copy step below only overwrites a header
        // when the verify response value is non-empty (e.g. a user in no group
        // returns an empty X-CPM-Groups, which would otherwise leave the
        // client's forged value intact).
        const cpmStripHeadersHandler: Record<string, unknown> = {
          handler: "headers",
          request: {
            delete: [...CPM_COPY_HEADERS]
          }
        };
        // Prepend the strip handler to the shared handler chain for all CPM
        // forward-auth routes.
        const cpmHandlers = [cpmStripHeadersHandler, ...handlers];

        // Build handle_response routes for copying user headers on 2xx
        const cpmHandleResponseRoutes: Record<string, unknown>[] = [
          { handle: [{ handler: "vars" }] }
        ];
        for (const headerName of CPM_COPY_HEADERS) {
          cpmHandleResponseRoutes.push({
            handle: [
              {
                handler: "headers",
                request: {
                  set: { [headerName]: [`{http.reverse_proxy.header.${headerName}}`] }
                }
              } as Record<string, unknown>
            ],
            match: [
              {
                not: [{ vars: { [`{http.reverse_proxy.header.${headerName}}`]: [""] } }]
              }
            ]
          });
        }

        // Forward auth handler — subrequest to CPM verify endpoint
        const cpmForwardAuthHandler: Record<string, unknown> = {
          handler: "reverse_proxy",
          upstreams: [{ dial: cpmDialAddress }],
          rewrite: {
            method: "GET",
            uri: "/api/forward-auth/verify"
          },
          headers: {
            request: {
              set: {
                "X-Forwarded-Method": ["{http.request.method}"],
                "X-Forwarded-Uri": ["{http.request.uri}"],
                "X-Forwarded-Host": ["{http.request.host}"],
                "X-Forwarded-Proto": ["{http.request.scheme}"]
              }
            }
          },
          handle_response: [
            {
              match: { status_code: [2] },
              routes: cpmHandleResponseRoutes
            },
            {
              match: { status_code: [401, 403] },
              routes: [
                {
                  handle: [
                    {
                      handler: "static_response",
                      status_code: 302,
                      headers: {
                        Location: [
                          `${config.baseUrl}/portal?rd={http.request.scheme}://{http.request.host}{http.request.uri}`
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          ],
          trusted_proxies: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "fd00::/8", "::1/128"]
        };

        // Callback route — unprotected, so it goes before forward_auth
        const cpmCallbackRoute: CaddyHttpRoute = {
          match: [{ path: ["/.cpm-auth/callback"] }],
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: cpmDialAddress }],
              rewrite: {
                uri: "/api/forward-auth/callback?{http.request.uri.query}"
              },
              headers: {
                request: {
                  set: {
                    "X-Forwarded-Host": ["{http.request.host}"],
                    "X-Forwarded-Proto": ["{http.request.scheme}"]
                  }
                }
              }
            }
          ],
          terminal: true
        };

        const locationRules = meta.location_rules ?? [];

        if (cpmForwardAuth.protected_paths && cpmForwardAuth.protected_paths.length > 0) {
          // Whitelist mode: only specified paths get auth
          for (const domainGroup of domainGroups) {
            // Add callback route (unprotected)
            hostRoutes.push({
              ...cpmCallbackRoute,
              match: [{ host: domainGroup, path: ["/.cpm-auth/callback"] }]
            });

            // Protected paths
            for (const protectedPath of cpmForwardAuth.protected_paths) {
              const protectedHandlers: Record<string, unknown>[] = [...cpmHandlers];
              const protectedReverseProxy = JSON.parse(JSON.stringify(reverseProxyHandler));
              protectedHandlers.push(cpmForwardAuthHandler);
              protectedHandlers.push(protectedReverseProxy);

              hostRoutes.push({
                match: [{ host: domainGroup, path: [protectedPath] }],
                handle: protectedHandlers,
                terminal: true
              });
            }

            // Location rules (unprotected)
            for (const rule of locationRules) {
              const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
                rule,
                Boolean(row.skipHttpsHostnameValidation),
                Boolean(row.preserveHostHeader)
              );
              if (!safePath) continue;
              hostRoutes.push({
                match: [{ host: domainGroup, path: [safePath] }],
                handle: [...cpmHandlers, locationProxy],
                terminal: true
              });
            }

            // Unprotected catch-all
            hostRoutes.push({
              match: [{ host: domainGroup }],
              handle: [...cpmHandlers, reverseProxyHandler],
              terminal: true
            });
          }
        } else if (cpmForwardAuth.excluded_paths && cpmForwardAuth.excluded_paths.length > 0) {
          // Exclusion mode: protect everything EXCEPT specified paths
          for (const domainGroup of domainGroups) {
            // Callback route first (unprotected)
            hostRoutes.push({
              ...cpmCallbackRoute,
              match: [{ host: domainGroup, path: ["/.cpm-auth/callback"] }]
            });

            // Excluded paths — unprotected, before the catch-all
            for (const excludedPath of cpmForwardAuth.excluded_paths) {
              hostRoutes.push({
                match: [{ host: domainGroup, path: [excludedPath] }],
                handle: [...cpmHandlers, JSON.parse(JSON.stringify(reverseProxyHandler))],
                terminal: true
              });
            }

            // Location rules with forward auth
            for (const rule of locationRules) {
              const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
                rule,
                Boolean(row.skipHttpsHostnameValidation),
                Boolean(row.preserveHostHeader)
              );
              if (!safePath) continue;
              hostRoutes.push({
                match: [{ host: domainGroup, path: [safePath] }],
                handle: [...cpmHandlers, cpmForwardAuthHandler, locationProxy],
                terminal: true
              });
            }

            // Catch-all with auth (everything not excluded)
            hostRoutes.push({
              match: [{ host: domainGroup }],
              handle: [...cpmHandlers, cpmForwardAuthHandler, reverseProxyHandler],
              terminal: true
            });
          }
        } else {
          // Full-site mode: protect everything
          for (const domainGroup of domainGroups) {
            // Callback route first (unprotected)
            hostRoutes.push({
              ...cpmCallbackRoute,
              match: [{ host: domainGroup, path: ["/.cpm-auth/callback"] }]
            });

            // Location rules with forward auth
            for (const rule of locationRules) {
              const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
                rule,
                Boolean(row.skipHttpsHostnameValidation),
                Boolean(row.preserveHostHeader)
              );
              if (!safePath) continue;
              hostRoutes.push({
                match: [{ host: domainGroup, path: [safePath] }],
                handle: [...cpmHandlers, cpmForwardAuthHandler, locationProxy],
                terminal: true
              });
            }

            // Main route with forward auth
            hostRoutes.push({
              match: [{ host: domainGroup }],
              handle: [...cpmHandlers, cpmForwardAuthHandler, reverseProxyHandler],
              terminal: true
            });
          }
        }
      }
    } else {
      const locationRules = meta.location_rules ?? [];
      const mtls = meta.mtls?.enabled ? meta.mtls : null;
      const mtlsProtectedPaths = mtls?.protected_paths?.length ? mtls.protected_paths : null;
      const mtlsExcludedPaths = mtls?.excluded_paths?.length ? mtls.excluded_paths : null;

      // Check for mTLS RBAC access rules for this proxy host
      const hostAccessRules = options.mtlsRbac?.accessRulesByHost.get(row.id);
      const hasMtlsRbac = hostAccessRules && hostAccessRules.length > 0
        && options.mtlsRbac?.roleFingerprintMap && options.mtlsRbac?.certFingerprintMap;
      const hostTrustedFingerprints = mtls
        ? resolveAllowedFingerprints(
            {
              pathPattern: "*",
              allowedRoleIds: mtls.trusted_role_ids ?? [],
              allowedCertIds: mtls.trusted_client_cert_ids ?? [],
              denyAll: false,
            },
            options.mtlsRbac?.roleFingerprintMap ?? new Map(),
            options.mtlsRbac?.certFingerprintMap ?? new Map()
          )
        : new Set<string>();
      const hostTrustedFingerprintExpression = hostTrustedFingerprints.size > 0
        ? buildFingerprintCelExpression(hostTrustedFingerprints)
        : validClientCertExpression;

      for (const domainGroup of domainGroups) {
        const pushProtectedCatchAllRoute = () => {
          if (hasMtlsRbac) {
            const rbacSubroutes = buildMtlsRbacSubroutes(
              hostAccessRules,
              options.mtlsRbac!.roleFingerprintMap,
              options.mtlsRbac!.certFingerprintMap,
              handlers,
              reverseProxyHandler,
              true,
              hostTrustedFingerprints
            );
            if (rbacSubroutes) {
              hostRoutes.push({
                match: [{ host: domainGroup }],
                handle: [{ handler: "subroute", routes: rbacSubroutes }],
                terminal: true,
              });
              return;
            }
          }

          hostRoutes.push({
            match: [{ host: domainGroup, expression: hostTrustedFingerprintExpression }],
            handle: [...handlers, reverseProxyHandler],
            terminal: true,
          });
          hostRoutes.push({
            match: [{ host: domainGroup }],
            handle: [{ handler: "static_response", status_code: "403", body: "mTLS access denied" }],
            terminal: true,
          });
        };

        if (mtlsProtectedPaths) {
          for (const protectedPath of mtlsProtectedPaths) {
            if (hasMtlsRbac) {
              const rbacSubroutes = buildMtlsRbacSubroutes(
                hostAccessRules,
                options.mtlsRbac!.roleFingerprintMap,
                options.mtlsRbac!.certFingerprintMap,
                handlers,
                reverseProxyHandler,
                true,
                hostTrustedFingerprints
              );
              if (rbacSubroutes) {
                hostRoutes.push({
                  match: [{ host: domainGroup, path: [protectedPath] }],
                  handle: [{ handler: "subroute", routes: rbacSubroutes }],
                  terminal: true,
                });
                continue;
              }
            }

            hostRoutes.push({
              match: [{ host: domainGroup, path: [protectedPath], expression: hostTrustedFingerprintExpression }],
              handle: [...handlers, JSON.parse(JSON.stringify(reverseProxyHandler))],
              terminal: true,
            });
            hostRoutes.push({
              match: [{ host: domainGroup, path: [protectedPath] }],
              handle: [{ handler: "static_response", status_code: "403", body: "mTLS access denied" }],
              terminal: true,
            });
          }

          for (const rule of locationRules) {
            const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
              rule,
              Boolean(row.skipHttpsHostnameValidation),
              Boolean(row.preserveHostHeader)
            );
            if (!safePath) continue;
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath] }],
              handle: [...handlers, locationProxy],
              terminal: true,
            });
          }

          hostRoutes.push({
            match: [{ host: domainGroup }],
            handle: [...handlers, reverseProxyHandler],
            terminal: true,
          });
          continue;
        }

        if (mtlsExcludedPaths) {
          for (const excludedPath of mtlsExcludedPaths) {
            hostRoutes.push({
              match: [{ host: domainGroup, path: [excludedPath] }],
              handle: [...handlers, JSON.parse(JSON.stringify(reverseProxyHandler))],
              terminal: true,
            });
          }

          for (const rule of locationRules) {
            const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
              rule,
              Boolean(row.skipHttpsHostnameValidation),
              Boolean(row.preserveHostHeader)
            );
            if (!safePath) continue;
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath], expression: hostTrustedFingerprintExpression }],
              handle: [...handlers, locationProxy],
              terminal: true,
            });
            hostRoutes.push({
              match: [{ host: domainGroup, path: [safePath] }],
              handle: [{ handler: "static_response", status_code: "403", body: "mTLS access denied" }],
              terminal: true,
            });
          }

          pushProtectedCatchAllRoute();
          continue;
        }

        for (const rule of locationRules) {
          const { safePath, reverseProxyHandler: locationProxy } = buildLocationReverseProxy(
            rule,
            Boolean(row.skipHttpsHostnameValidation),
            Boolean(row.preserveHostHeader)
          );
          if (!safePath) continue;
          hostRoutes.push({
            match: [{ host: domainGroup, path: [safePath] }],
            handle: [...handlers, locationProxy],
            terminal: true,
          });
        }

        if (hasMtlsRbac) {
          const rbacSubroutes = buildMtlsRbacSubroutes(
            hostAccessRules,
            options.mtlsRbac!.roleFingerprintMap,
            options.mtlsRbac!.certFingerprintMap,
            handlers,
            reverseProxyHandler
          );
          if (rbacSubroutes) {
            hostRoutes.push({
              match: [{ host: domainGroup }],
              handle: [{
                handler: "subroute",
                routes: rbacSubroutes,
              }],
              terminal: true,
            });
          } else {
            hostRoutes.push({
              match: [{ host: domainGroup }],
              handle: [...handlers, reverseProxyHandler],
              terminal: true,
            });
          }
        } else {
          const route: CaddyHttpRoute = {
            match: [{ host: domainGroup }],
            handle: [...handlers, reverseProxyHandler],
            terminal: true,
          };
          hostRoutes.push(route);
        }
      }
    }

    routes.push(...hostRoutes);

    // Per-host error pages, scoped to this host's domains. Collected separately so
    // they can be attached to the server-level `errors` block (handle_errors).
    if (meta.error_pages && meta.error_pages.length > 0) {
      for (const rule of meta.error_pages) {
        errorRoutes.push(buildErrorPageRoute(rule, domains));
      }
    }
  }

  return { routes: sortRoutesByHostPriority(routes), errorRoutes };
}

function buildTlsConnectionPolicies(
  usage: Map<number, CertificateUsage>,
  managedCertificatesWithAutomation: Set<number>,
  autoManagedDomains: Set<string>,
  mTlsDomainMap: Map<string, number[]>,
  caCertMap: Map<number, { id: number; certificatePem: string }>,
  issuedClientCertMap: Map<number, string[]>,
  cAsWithAnyIssuedCerts: Set<number>,
  mTlsDomainLeafOverride: Map<string, string[]>,
  mTlsOptionalAuthDomains: Set<string>
) {
  const policies: Record<string, unknown>[] = [];
  const readyCertificates = new Set<number>();
  const importedCertPems: { certificate: string; key: string }[] = [];

  const buildAuth = (domains: string[], mode: "require_and_verify" | "verify_if_given" | "request") =>
    buildClientAuthentication(domains, mTlsDomainMap, caCertMap, issuedClientCertMap, cAsWithAnyIssuedCerts, mTlsDomainLeafOverride, mode);

  /**
   * Pushes one TLS policy per unique CA set found in `mTlsDomains`.
   * Domains that share the same CA configuration are grouped into one policy;
   * domains with different CAs get separate policies so a cert from CA_B cannot
   * authenticate against a host that only trusts CA_A.
   */
  const pushMtlsPolicies = (mTlsDomains: string[]) => {
    const scopedDomains = mTlsDomains.filter((domain) => mTlsOptionalAuthDomains.has(domain));
    const requiredDomains = mTlsDomains.filter((domain) => !mTlsOptionalAuthDomains.has(domain));

    for (const [domains, mode] of [
      [requiredDomains, "require_and_verify"],
      [scopedDomains, "request"],
    ] as const) {
      if (domains.length === 0) continue;

      const groups = groupMtlsDomainsByCaSet(domains, mTlsDomainMap);
      for (const domainGroup of groups.values()) {
        for (const priorityGroup of groupHostPatternsByPriority(domainGroup)) {
          const mTlsAuth = buildAuth(priorityGroup, mode);
          if (mTlsAuth) {
            policies.push({ match: { sni: priorityGroup }, client_authentication: mTlsAuth });
          } else {
            // All CAs have all certs revoked — drop connections rather than allow through without mTLS
            policies.push({ match: { sni: priorityGroup }, drop: true });
          }
        }
      }
    }
  };

  // Add policy for auto-managed domains (certificateId = null)
  if (autoManagedDomains.size > 0) {
    const domains = Array.from(autoManagedDomains);
    // Split first so mTLS domains always get their own policy, regardless of auth result.
    const mTlsDomains = domains.filter(d => mTlsDomainMap.has(d));
    const nonMTlsDomains = domains.filter(d => !mTlsDomainMap.has(d));

    if (mTlsDomains.length > 0) {
      pushMtlsPolicies(mTlsDomains);
    }
    for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
      policies.push({ match: { sni: priorityGroup } });
    }
  }

  for (const [id, entry] of usage.entries()) {
    const domains = Array.from(entry.domains);
    if (domains.length === 0) {
      continue;
    }

    if (entry.certificate.type === "imported") {
      if (!entry.certificate.certificatePem || !entry.certificate.privateKeyPem) {
        continue;
      }

      // Collect PEMs for tls.certificates.load_pem (inline, no shared filesystem needed)
      importedCertPems.push({
        certificate: entry.certificate.certificatePem.trim(),
        key: entry.certificate.privateKeyPem.trim()
      });

      const mTlsDomains = domains.filter(d => mTlsDomainMap.has(d));
      const nonMTlsDomains = domains.filter(d => !mTlsDomainMap.has(d));

      if (mTlsDomains.length > 0) {
        pushMtlsPolicies(mTlsDomains);
      }
      for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
        policies.push({ match: { sni: priorityGroup } });
      }

      readyCertificates.add(id);
      continue;
    }

    if (entry.certificate.type === "managed") {
      if (!managedCertificatesWithAutomation.has(id)) {
        continue;
      }

      const mTlsDomains = domains.filter(d => mTlsDomainMap.has(d));
      const nonMTlsDomains = domains.filter(d => !mTlsDomainMap.has(d));

      if (mTlsDomains.length > 0) {
        pushMtlsPolicies(mTlsDomains);
      }
      for (const priorityGroup of groupHostPatternsByPriority(nonMTlsDomains)) {
        policies.push({ match: { sni: priorityGroup } });
      }

      readyCertificates.add(id);
    }
  }

  return {
    policies: sortTlsPoliciesBySniPriority(policies),
    readyCertificates,
    importedCertPems
  };
}

async function buildTlsAutomation(
  usage: Map<number, CertificateUsage>,
  autoManagedDomains: Set<string>,
  options: { acmeEmail?: string; dnsSettings?: DnsSettings | null }
) {
  const managedEntries = Array.from(usage.values()).filter(
    (entry) => entry.certificate.type === "managed" && Boolean(entry.certificate.autoRenew)
  );

  const hasAutoManagedDomains = autoManagedDomains.size > 0;

  if (managedEntries.length === 0 && !hasAutoManagedDomains) {
    return {
      managedCertificateIds: new Set<number>()
    };
  }

  const dnsProviderSettings = await getDnsProviderSettings();
  const globalDnsProvider: DnsProviderCredentials | null =
    dnsProviderSettings?.default && dnsProviderSettings.providers[dnsProviderSettings.default]
      ? { provider: dnsProviderSettings.default, credentials: dnsProviderSettings.providers[dnsProviderSettings.default] }
      : null;

  const dnsSettings = options.dnsSettings ?? await getDnsSettings();
  const hasDnsResolvers = dnsSettings && dnsSettings.enabled && dnsSettings.resolvers && dnsSettings.resolvers.length > 0;

  // Build DNS resolvers list (primary + fallbacks)
  const dnsResolvers: string[] = [];
  if (hasDnsResolvers) {
    dnsResolvers.push(...dnsSettings.resolvers);
    if (dnsSettings.fallbacks && dnsSettings.fallbacks.length > 0) {
      dnsResolvers.push(...dnsSettings.fallbacks);
    }
  }

  const managedCertificateIds = new Set<number>();
  const policies: Record<string, unknown>[] = [];

  // Add policy for auto-managed domains (certificateId = null)
  if (hasAutoManagedDomains) {
    for (const subjects of groupHostPatternsByPriority(Array.from(autoManagedDomains))) {
      const issuer: Record<string, unknown> = {
        module: "acme"
      };

      if (options.acmeEmail) {
        issuer.email = options.acmeEmail;
      }

      if (globalDnsProvider) {
        const dnsChallenge = buildDnsChallengeConfig(
          globalDnsProvider.provider,
          globalDnsProvider.credentials,
          dnsResolvers
        );
        if (dnsChallenge) {
          issuer.challenges = { dns: dnsChallenge };
        }
      }

      policies.push({
        subjects,
        issuers: [issuer]
      });
    }
  }

  // Add policies for explicitly managed certificates
  for (const entry of managedEntries) {
    const subjects = Array.from(entry.domains);
    if (subjects.length === 0) {
      continue;
    }

    managedCertificateIds.add(entry.certificate.id);

    // Per-certificate provider override, falling back to global default
    let effectiveProvider = globalDnsProvider;
    const certOptions = entry.certificate.providerOptions as { provider?: string } | null;
    if (certOptions?.provider && dnsProviderSettings?.providers[certOptions.provider]) {
      effectiveProvider = {
        provider: certOptions.provider,
        credentials: dnsProviderSettings.providers[certOptions.provider],
      };
    }

    for (const subjectGroup of groupHostPatternsByPriority(subjects)) {
      const issuer: Record<string, unknown> = {
        module: "acme"
      };

      if (options.acmeEmail) {
        issuer.email = options.acmeEmail;
      }

      if (effectiveProvider) {
        const dnsChallenge = buildDnsChallengeConfig(
          effectiveProvider.provider,
          effectiveProvider.credentials,
          dnsResolvers
        );
        if (dnsChallenge) {
          issuer.challenges = { dns: dnsChallenge };
        }
      }

      policies.push({
        subjects: subjectGroup,
        issuers: [issuer]
      });
    }
  }

  if (policies.length === 0) {
    return {
      managedCertificateIds
    };
  }

  return {
    tlsApp: {
      automation: {
        policies: sortAutomationPoliciesBySubjectPriority(policies)
      }
    },
    managedCertificateIds
  };
}

async function buildL4Servers(): Promise<Record<string, unknown> | null> {
  const l4Hosts = await db
    .select()
    .from(l4ProxyHosts)
    .where(eq(l4ProxyHosts.enabled, true));

  if (l4Hosts.length === 0) return null;

  const [globalDnsSettings, globalUpstreamDnsResolutionSettings, globalGeoBlock] = await Promise.all([
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getGeoBlockSettings(),
  ]);

  // Group hosts by listen address — multiple hosts on the same port share routes in one server
  const serverMap = new Map<string, typeof l4Hosts>();
  for (const host of l4Hosts) {
    const key = host.listenAddress;
    if (!serverMap.has(key)) serverMap.set(key, []);
    serverMap.get(key)!.push(host);
  }

  const servers: Record<string, unknown> = {};
  let serverIdx = 0;
  for (const [listenAddr, hosts] of serverMap) {
    const routes: Record<string, unknown>[] = [];

    for (const host of hosts) {
      const route: Record<string, unknown> = {};

      // Build matchers
      const matcherType = host.matcherType as string;
      const matcherValues = host.matcherValue ? parseJson<string[]>(host.matcherValue, []) : [];

      if (matcherType === "tls_sni" && matcherValues.length > 0) {
        route.match = [{ tls: { sni: matcherValues } }];
      } else if (matcherType === "http_host" && matcherValues.length > 0) {
        route.match = [{ http: [{ host: matcherValues }] }];
      } else if (matcherType === "proxy_protocol") {
        route.match = [{ proxy_protocol: {} }];
      }
      // "none" = no match block (catch-all)

      // Parse per-host meta for load balancing, DNS resolver, and upstream DNS resolution
      const meta = parseJson<L4Meta>(host.meta, {});

      // Load balancer config
      const lbMeta = meta.load_balancer;
      let lbConfig: LoadBalancerRouteConfig | null = null;
      if (lbMeta?.enabled) {
        lbConfig = {
          enabled: true,
          policy: lbMeta.policy ?? "random",
          policyHeaderField: null,
          policyCookieName: null,
          policyCookieSecret: null,
          tryDuration: lbMeta.try_duration ?? null,
          tryInterval: lbMeta.try_interval ?? null,
          retries: lbMeta.retries ?? null,
          activeHealthCheck: lbMeta.active_health_check?.enabled ? {
            enabled: true,
            uri: null,
            port: lbMeta.active_health_check.port ?? null,
            interval: lbMeta.active_health_check.interval ?? null,
            timeout: lbMeta.active_health_check.timeout ?? null,
            status: null,
            body: null,
          } : null,
          passiveHealthCheck: lbMeta.passive_health_check?.enabled ? {
            enabled: true,
            failDuration: lbMeta.passive_health_check.fail_duration ?? null,
            maxFails: lbMeta.passive_health_check.max_fails ?? null,
            unhealthyStatus: null,
            unhealthyLatency: lbMeta.passive_health_check.unhealthy_latency ?? null,
          } : null,
        };
      }

      // DNS resolver config
      const dnsConfig = parseDnsResolverConfig(meta.dns_resolver);

      // Upstream DNS resolution (pinning)
      const hostDnsResolution = parseUpstreamDnsResolutionConfig(meta.upstream_dns_resolution);
      const effectiveDnsResolution = resolveEffectiveUpstreamDnsResolution(
        globalUpstreamDnsResolutionSettings,
        hostDnsResolution
      );

      // Build handler chain
      const handlers: Record<string, unknown>[] = [];

      // 1. Receive inbound proxy protocol
      if (host.proxyProtocolReceive) {
        handlers.push({ handler: "proxy_protocol" });
      }

      // 2. TLS termination
      if (host.tlsTermination) {
        handlers.push({ handler: "tls" });
      }

      // 3. Proxy handler
      const upstreams = parseJson<string[]>(host.upstreams, []);

      // Resolve upstream hostnames to IPs if DNS pinning is enabled
      let resolvedDials = upstreams;
      if (effectiveDnsResolution.enabled) {
        const resolver = new Resolver();
        const lookupServers = getLookupServers(dnsConfig, globalDnsSettings);
        if (lookupServers.length > 0) {
          try { resolver.setServers(lookupServers); } catch { /* ignore invalid servers */ }
        }
        const timeoutMs = getLookupTimeoutMs(dnsConfig, globalDnsSettings);

        const pinned: string[] = [];
        for (const upstream of upstreams) {
          const colonIdx = upstream.lastIndexOf(":");
          if (colonIdx <= 0) { pinned.push(upstream); continue; }
          const hostPart = upstream.substring(0, colonIdx);
          const portPart = upstream.substring(colonIdx + 1);
          if (isIP(hostPart) !== 0) { pinned.push(upstream); continue; }
          try {
            const addresses = await resolveHostnameAddresses(resolver, hostPart, effectiveDnsResolution.family, timeoutMs);
            for (const addr of addresses) {
              pinned.push(addr.includes(":") ? `[${addr}]:${portPart}` : `${addr}:${portPart}`);
            }
          } catch {
            pinned.push(upstream);
          }
        }
        resolvedDials = pinned;
      }

      // For UDP hosts, upstream dials must also use the udp/ prefix
      const dialPrefix = (host.protocol as string) === "udp" ? "udp/" : "";
      const proxyHandler: Record<string, unknown> = {
        handler: "proxy",
        upstreams: resolvedDials.map((u) => ({ dial: [`${dialPrefix}${u}`] })),
      };
      if (host.proxyProtocolVersion) {
        proxyHandler.proxy_protocol = host.proxyProtocolVersion;
      }
      if (lbConfig) {
        const loadBalancing = buildLoadBalancingConfig(lbConfig);
        if (loadBalancing) proxyHandler.load_balancing = loadBalancing;
        const healthChecks = buildHealthChecksConfig(lbConfig);
        if (healthChecks) proxyHandler.health_checks = healthChecks;
      }
      handlers.push(proxyHandler);

      route.handle = handlers;

      // Geo blocking: add a blocking route BEFORE the proxy route.
      // At L4, the blocker is a matcher (layer4.matchers.blocker) — blocked connections
      // match this route and are closed. Non-blocked connections fall through to the proxy route.
      const effectiveGeoBlock = resolveEffectiveGeoBlock(globalGeoBlock, {
        geoblock: meta.geoblock ?? null,
        geoblock_mode: meta.geoblock_mode ?? "merge",
      });
      if (effectiveGeoBlock) {
        const blockerMatcher: Record<string, unknown> = {
          geoip_db: "/usr/share/GeoIP/GeoLite2-Country.mmdb",
          asn_db: "/usr/share/GeoIP/GeoLite2-ASN.mmdb",
        };
        if (effectiveGeoBlock.block_countries?.length) blockerMatcher.block_countries = effectiveGeoBlock.block_countries;
        if (effectiveGeoBlock.block_continents?.length) blockerMatcher.block_continents = effectiveGeoBlock.block_continents;
        if (effectiveGeoBlock.block_asns?.length) blockerMatcher.block_asns = effectiveGeoBlock.block_asns;
        if (effectiveGeoBlock.block_cidrs?.length) blockerMatcher.block_cidrs = effectiveGeoBlock.block_cidrs;
        if (effectiveGeoBlock.block_ips?.length) blockerMatcher.block_ips = effectiveGeoBlock.block_ips;
        if (effectiveGeoBlock.allow_countries?.length) blockerMatcher.allow_countries = effectiveGeoBlock.allow_countries;
        if (effectiveGeoBlock.allow_continents?.length) blockerMatcher.allow_continents = effectiveGeoBlock.allow_continents;
        if (effectiveGeoBlock.allow_asns?.length) blockerMatcher.allow_asns = effectiveGeoBlock.allow_asns;
        if (effectiveGeoBlock.allow_cidrs?.length) blockerMatcher.allow_cidrs = effectiveGeoBlock.allow_cidrs;
        if (effectiveGeoBlock.allow_ips?.length) blockerMatcher.allow_ips = effectiveGeoBlock.allow_ips;

        // Build the same route matcher as the proxy route (if any)
        const blockRoute: Record<string, unknown> = {
          match: [
            {
              blocker: blockerMatcher,
              ...(route.match ? (route.match as Record<string, unknown>[])[0] : {}),
            },
          ],
          handle: [{ handler: "close" }],
        };
        routes.push(blockRoute);
      }

      routes.push(route);
    }

    // Determine protocol from the hosts on this listen address.
    // All hosts sharing a listen address must use the same protocol.
    const protocol = hosts[0].protocol as string;
    const listenValue = protocol === "udp" ? `udp/${listenAddr}` : listenAddr;

    servers[`l4_server_${serverIdx++}`] = {
      listen: [listenValue],
      routes,
    };
  }

  return servers;
}

export async function buildCaddyDocument() {
  const [proxyHostRecords, certRows, accessListEntryRecords, caCertRows, issuedClientCertRows, allIssuedCaCertIds] = await Promise.all([
    db
      .select({
        id: proxyHosts.id,
        name: proxyHosts.name,
        domains: proxyHosts.domains,
        upstreams: proxyHosts.upstreams,
        certificateId: proxyHosts.certificateId,
        accessListId: proxyHosts.accessListId,
        sslForced: proxyHosts.sslForced,
        hstsEnabled: proxyHosts.hstsEnabled,
        hstsSubdomains: proxyHosts.hstsSubdomains,
        allowWebsocket: proxyHosts.allowWebsocket,
        preserveHostHeader: proxyHosts.preserveHostHeader,
        skipHttpsHostnameValidation: proxyHosts.skipHttpsHostnameValidation,
        meta: proxyHosts.meta,
        enabled: proxyHosts.enabled
      })
      .from(proxyHosts),
    db
      .select({
        id: certificates.id,
        name: certificates.name,
        type: certificates.type,
        domainNames: certificates.domainNames,
        certificatePem: certificates.certificatePem,
        privateKeyPem: certificates.privateKeyPem,
        autoRenew: certificates.autoRenew,
        providerOptions: certificates.providerOptions
      })
      .from(certificates),
    db
      .select({
        accessListId: accessListEntries.accessListId,
        username: accessListEntries.username,
        passwordHash: accessListEntries.passwordHash
      })
      .from(accessListEntries),
    db
      .select({
        id: caCertificates.id,
        certificatePem: caCertificates.certificatePem
      })
      .from(caCertificates),
    db
      .select({
        id: issuedClientCertificates.id,
        caCertificateId: issuedClientCertificates.caCertificateId,
        certificatePem: issuedClientCertificates.certificatePem
      })
      .from(issuedClientCertificates)
      .where(isNull(issuedClientCertificates.revokedAt)),
    // Distinct CA IDs that have ever had a tracked issued cert (including revoked).
    // Used to distinguish "managed" CAs (pin to leaf certs) from "unmanaged" CAs
    // (trust any cert signed by that CA).
    db
      .selectDistinct({ caCertificateId: issuedClientCertificates.caCertificateId })
      .from(issuedClientCertificates)
  ]);

  const proxyHostRows: ProxyHostRow[] = proxyHostRecords.map((h) => ({
    id: h.id,
    name: h.name,
    domains: h.domains,
    upstreams: h.upstreams,
    certificateId: h.certificateId,
    accessListId: h.accessListId,
    sslForced: h.sslForced ? 1 : 0,
    hstsEnabled: h.hstsEnabled ? 1 : 0,
    hstsSubdomains: h.hstsSubdomains ? 1 : 0,
    allowWebsocket: h.allowWebsocket ? 1 : 0,
    preserveHostHeader: h.preserveHostHeader ? 1 : 0,
    skipHttpsHostnameValidation: h.skipHttpsHostnameValidation ? 1 : 0,
    meta: h.meta,
    enabled: h.enabled ? 1 : 0
  }));

  const certRowsMapped: CertificateRow[] = certRows.map((c: typeof certRows[0]) => ({
    id: c.id,
    name: c.name,
    type: c.type as "managed" | "imported",
    domainNames: c.domainNames,
    certificatePem: c.certificatePem,
    privateKeyPem: c.privateKeyPem,
    autoRenew: c.autoRenew ? 1 : 0,
    providerOptions: c.providerOptions
  }));

  const accessListEntryRows: AccessListEntryRow[] = accessListEntryRecords.map((entry) => ({
    accessListId: entry.accessListId,
    username: entry.username,
    passwordHash: entry.passwordHash
  }));

  const certificateMap = new Map(certRowsMapped.map((cert) => [cert.id, cert]));
  const caCertMap = new Map(caCertRows.map((ca) => [ca.id, ca]));
  const issuedClientCertMap = issuedClientCertRows.reduce<Map<number, string[]>>((map, record) => {
    const current = map.get(record.caCertificateId) ?? [];
    current.push(record.certificatePem);
    map.set(record.caCertificateId, current);
    return map;
  }, new Map());
  const cAsWithAnyIssuedCerts = new Set(allIssuedCaCertIds.map(r => r.caCertificateId));
  const accessMap = accessListEntryRows.reduce<Map<number, AccessListEntryRow[]>>((map, entry) => {
    if (!map.has(entry.accessListId)) {
      map.set(entry.accessListId, []);
    }
    map.get(entry.accessListId)!.push(entry);
    return map;
  }, new Map());

  // Build a lookup: issued cert ID → { id, caCertificateId, certificatePem } (active only)
  const issuedCertById = new Map(issuedClientCertRows.map(r => [r.id, r]));

  // Resolve role IDs → cert IDs for trusted_role_ids in mTLS config
  const roleCertIdMap = await buildRoleCertIdMap();

  // Build domain → CA cert IDs map for mTLS-enabled hosts.
  // New model (trusted_client_cert_ids + trusted_role_ids): derive CAs from selected certs and pin to those certs.
  // Old model (ca_certificate_ids): trust entire CAs as before.
  const mTlsDomainMap = new Map<string, number[]>();
  // Per-domain override: which specific leaf cert PEMs to pin (new model only)
  const mTlsDomainLeafOverride = new Map<string, string[]>();
  const mTlsOptionalAuthDomains = new Set<string>();
  for (const row of proxyHostRows) {
    if (!row.enabled) continue;
    const meta = parseJson<{ mtls?: MtlsConfig }>(row.meta, {});
    if (!meta.mtls?.enabled) continue;

    const domains = parseJson<string[]>(row.domains, []).map(d => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length === 0) continue;

    if (meta.mtls.protected_paths?.length || meta.mtls.excluded_paths?.length) {
      for (const domain of domains) {
        mTlsOptionalAuthDomains.add(domain);
      }
    }

    // Collect all trusted cert IDs from both direct selection and roles
    const allCertIds = new Set<number>();
    if (meta.mtls.trusted_client_cert_ids) {
      for (const id of meta.mtls.trusted_client_cert_ids) allCertIds.add(id);
    }
    if (meta.mtls.trusted_role_ids) {
      for (const roleId of meta.mtls.trusted_role_ids) {
        const certIds = roleCertIdMap.get(roleId);
        if (certIds) for (const id of certIds) allCertIds.add(id);
      }
    }

    if (allCertIds.size > 0) {
      // New model: pin trust to the explicitly-selected client certs — derive
      // their CAs for chain validation and collect the leaf PEMs for pinning.
      const derivedCaIds = new Set<number>();
      const leafPems: string[] = [];
      for (const certId of allCertIds) {
        const cert = issuedCertById.get(certId);
        if (cert) {
          derivedCaIds.add(cert.caCertificateId);
          leafPems.push(cert.certificatePem);
        }
      }
      if (leafPems.length > 0) {
        const caIdArr = Array.from(derivedCaIds);
        for (const domain of domains) {
          mTlsDomainMap.set(domain, caIdArr);
          mTlsDomainLeafOverride.set(domain, leafPems);
        }
      } else {
        // Every explicitly-selected cert/role resolved to ZERO active leaves
        // (all revoked or deleted). FAIL CLOSED with a deny-all (drop) policy.
        // Do NOT derive the CA and fall back to whole-CA trust: that would trust
        // other active certs of the same CA that were never assigned to this
        // host (and "request" mode would accept any presented cert). Force
        // require_and_verify with an empty trust set → buildClientAuthentication
        // returns null → buildTlsConnectionPolicies emits a drop-all policy.
        for (const domain of domains) {
          mTlsDomainMap.set(domain, []);
          mTlsOptionalAuthDomains.delete(domain);
        }
      }
    } else if (meta.mtls.ca_certificate_ids?.length) {
      // Legacy model: trust entire CAs (backward compat)
      for (const domain of domains) {
        mTlsDomainMap.set(domain, meta.mtls.ca_certificate_ids);
      }
    } else {
      // mTLS is enabled but no trust resolved — e.g. trust is role-only and
      // every cert in those roles was revoked or the role is empty, or nothing
      // was selected — and there is no legacy CA trust. FAIL CLOSED: keep the
      // domain in the mTLS map with an empty CA set (buildClientAuthentication
      // returns null → buildTlsConnectionPolicies emits a drop-all policy) and
      // force require_and_verify so even protected/excluded-path hosts reject
      // all connections rather than silently serving the backend with no client
      // certificate required.
      for (const domain of domains) {
        mTlsDomainMap.set(domain, []);
        mTlsOptionalAuthDomains.delete(domain);
      }
    }
  }

  // Build mTLS RBAC data for HTTP-layer enforcement
  const enabledProxyHostIds = proxyHostRows.filter((r) => r.enabled).map((r) => r.id);
  const [roleFingerprintMap, certFingerprintMap, accessRulesByHost] = await Promise.all([
    buildRoleFingerprintMap(),
    buildCertFingerprintMap(),
    getAccessRulesForHosts(enabledProxyHostIds),
  ]);

  const { usage: certificateUsage, autoManagedDomains } = collectCertificateUsage(proxyHostRows, certificateMap);
  const [generalSettings, dnsSettings, upstreamDnsResolutionSettings, globalGeoBlock, globalWaf] = await Promise.all([
    getGeneralSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getGeoBlockSettings(),
    getWafSettings()
  ]);
  const { tlsApp, managedCertificateIds } = await buildTlsAutomation(certificateUsage, autoManagedDomains, {
    acmeEmail: generalSettings?.acmeEmail,
    dnsSettings
  });
  const { policies: tlsConnectionPolicies, readyCertificates, importedCertPems } = buildTlsConnectionPolicies(
    certificateUsage,
    managedCertificateIds,
    autoManagedDomains,
    mTlsDomainMap,
    caCertMap,
    issuedClientCertMap,
    cAsWithAnyIssuedCerts,
    mTlsDomainLeafOverride,
    mTlsOptionalAuthDomains
  );

  const { routes: httpRoutes, errorRoutes: hostErrorRoutes } = await buildProxyRoutes(
    proxyHostRows,
    accessMap,
    readyCertificates,
    {
      globalDnsSettings: dnsSettings,
      globalUpstreamDnsResolutionSettings: upstreamDnsResolutionSettings,
      globalGeoBlock,
      globalWaf,
      mtlsRbac: {
        roleFingerprintMap,
        certFingerprintMap,
        accessRulesByHost,
      },
    }
  );

  // Server-level error routes (Caddy handle_errors): per-host rules first so they
  // take precedence, then global rules act as a fallback for any unmatched host/status.
  const globalErrorPages = await getErrorPagesSettings();
  const globalErrorRoutes = (globalErrorPages?.rules ?? []).map((rule) => buildErrorPageRoute(rule));
  const errorRoutes: CaddyHttpRoute[] = [...hostErrorRoutes, ...globalErrorRoutes];

  const hasTls = tlsConnectionPolicies.length > 0;

  // Check if metrics should be enabled
  const metricsSettings = await getMetricsSettings();
  const metricsEnabled = metricsSettings?.enabled ?? false;
  const metricsPort = metricsSettings?.port ?? 9090;

  // Check if access logging should be enabled
  const loggingSettings = await getLoggingSettings();
  const loggingEnabled = loggingSettings?.enabled ?? false;
  const loggingFormat = loggingSettings?.format ?? "json";

  const servers: Record<string, unknown> = {};

  // Main HTTP/HTTPS server for proxy hosts
  if (httpRoutes.length > 0) {
    servers.cpm = {
      listen: hasTls ? [":80", ":443"] : [":80"],
      routes: httpRoutes,
      // Only disable automatic HTTPS if we have TLS automation policies
      // This allows Caddy to handle HTTP-01 challenges for managed certificates
      ...(tlsApp ? {} : { automatic_https: { disable: true } }),
      ...(hasTls ? { tls_connection_policies: tlsConnectionPolicies } : {}),
      // Custom error pages (handle_errors)
      ...(errorRoutes.length > 0 ? { errors: { routes: errorRoutes } } : {}),
      // Enable access logging if configured
      ...(loggingEnabled ? { logs: { default_logger_name: "http_access" } } : {})
    };
  }

  // Metrics server - exposes /metrics endpoint on separate port
  if (metricsEnabled) {
    servers.metrics = {
      listen: [`:${metricsPort}`],
      routes: [
        {
          handle: [
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: "localhost:2019" }],
              rewrite: {
                uri: "/metrics"
              }
            }
          ]
        }
      ]
    };
  }

  const httpApp = Object.keys(servers).length > 0 ? { http: { servers } } : {};

  // Build logging configuration
  const loggingLogs: Record<string, unknown> = {
    // Always capture WAF rule match logs so the waf-log-parser can extract rule details.
    // Coraza does not write matched rules to the audit log (known bug), but it does emit
    // structured JSON lines via the http.handlers.waf logger for each matched rule.
    waf_rules: {
      writer: { output: "file", filename: "/logs/waf-rules.log", mode: "0640" },
      encoder: { format: "json" },
      include: ["http.handlers.waf"],
      level: "ERROR"
    }
  };
  if (loggingEnabled) {
    loggingLogs.http_access = {
      writer: { output: "file", filename: "/logs/access.log", mode: "0640" },
      encoder: { format: loggingFormat },
      include: ["http.log.access", "http.handlers.blocker"]
    };
  }
  const loggingApp = { logging: { logs: loggingLogs } };

  // Build L4 (TCP/UDP) proxy servers
  const l4Servers = await buildL4Servers();
  const l4App = l4Servers ? { layer4: { servers: l4Servers } } : {};

  return {
    admin: {
      listen: "0.0.0.0:2019",
      origins: ["caddy:2019", "localhost:2019", "localhost"]
    },
    ...loggingApp,
    apps: {
      ...httpApp,
      ...(tlsApp || importedCertPems.length > 0 ? {
        tls: {
          ...(tlsApp ?? {}),
          ...(importedCertPems.length > 0 ? { certificates: { load_pem: importedCertPems } } : {})
        }
      } : {}),
      ...l4App
    }
  };
}

/**
 * Plain HTTP/HTTPS request to the Caddy admin API using node:http.
 * Avoids browser-security headers (Sec-Fetch-*) that native fetch sends,
 * which would trigger Caddy's CORS origin enforcement.
 */
function caddyRequest(url: string, method: string, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {})
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function applyCaddyConfig() {
  const document = await buildCaddyDocument();
  const payload = JSON.stringify(document);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  setSetting("caddy_config_hash", { hash, updatedAt: nowIso() });

  try {
    const response = await caddyRequest(`${config.caddyApiUrl}/load`, "POST", payload);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Caddy config load failed: ${response.status} ${response.text}`);
    }

    await syncInstances();
  } catch (error) {
    console.error("Failed to apply Caddy config", error);

    // Check if it's a fetch error with ECONNREFUSED or ENOTFOUND
    const err = error as { cause?: NodeJS.ErrnoException };
    const causeCode = err?.cause?.code;

    if (causeCode === "ENOTFOUND" || causeCode === "ECONNREFUSED") {
      throw new Error(
        `Unable to reach Caddy API at ${config.caddyApiUrl}. Ensure Caddy is running and accessible.`,
        { cause: error }
      );
    }

    throw error;
  }
}

/**
 * Derives the dial address (host:port) for Caddy to reach CPM internally.
 * Uses FORWARD_AUTH_INTERNAL_URL env var if set. Otherwise, if CADDY_API_URL
 * points to a Docker service name (e.g. "caddy:2019"), assumes Docker networking
 * and defaults to "web:3000". Falls back to deriving from BASE_URL.
 */
function getCpmDialAddress(): string | null {
  const internalUrl = config.forwardAuthInternalUrl;
  if (internalUrl) {
    // Strip protocol, trailing slashes, and paths
    return internalUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  // If CADDY_API_URL uses a Docker service name, assume Docker networking
  // and use the web service name directly
  try {
    const caddyUrl = new URL(config.caddyApiUrl);
    if (caddyUrl.hostname !== "localhost" && caddyUrl.hostname !== "127.0.0.1" && caddyUrl.hostname !== "::1") {
      // Caddy is on a Docker network — CPM is the "web" service on port 3000
      return "web:3000";
    }
  } catch {
    // ignore
  }

  // Derive from BASE_URL (works for non-Docker setups)
  try {
    const url = new URL(config.baseUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname}:${port}`;
  } catch {
    return null;
  }
}

function parseAuthentikConfig(meta: ProxyHostAuthentikMeta | undefined | null): AuthentikRouteConfig | null {
  if (!meta || !meta.enabled) {
    return null;
  }

  const outpostDomain = typeof meta.outpost_domain === "string" ? meta.outpost_domain.trim() : "";
  const outpostUpstream = typeof meta.outpost_upstream === "string" ? meta.outpost_upstream.trim() : "";
  if (!outpostDomain || !outpostUpstream) {
    return null;
  }

  const authEndpointRaw = typeof meta.auth_endpoint === "string" ? meta.auth_endpoint.trim() : "";
  const authEndpoint = authEndpointRaw || `/${outpostDomain}/auth/caddy`;

  const copyHeaders =
    Array.isArray(meta.copy_headers) && meta.copy_headers.length > 0
      ? meta.copy_headers.map((header) => header?.trim()).filter((header): header is string => Boolean(header))
      : DEFAULT_AUTHENTIK_HEADERS;

  const trustedProxies =
    Array.isArray(meta.trusted_proxies) && meta.trusted_proxies.length > 0
      ? meta.trusted_proxies.map((item) => item?.trim()).filter((item): item is string => Boolean(item))
      : DEFAULT_AUTHENTIK_TRUSTED_PROXIES;

  const setOutpostHostHeader =
    meta.set_outpost_host_header !== undefined ? Boolean(meta.set_outpost_host_header) : true;

  const protectedPaths =
    Array.isArray(meta.protected_paths) && meta.protected_paths.length > 0
      ? meta.protected_paths.map((path) => path?.trim()).filter((path): path is string => Boolean(path))
      : null;

  const excludedPaths =
    Array.isArray(meta.excluded_paths) && meta.excluded_paths.length > 0
      ? meta.excluded_paths.map((path) => path?.trim()).filter((path): path is string => Boolean(path))
      : null;

  return {
    enabled: true,
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

const VALID_LB_POLICIES = ["random", "round_robin", "least_conn", "ip_hash", "first", "header", "cookie", "uri_hash"];

function parseLoadBalancerConfig(meta: LoadBalancerMeta | undefined | null): LoadBalancerRouteConfig | null {
  if (!meta || !meta.enabled) {
    return null;
  }

  const policy = meta.policy && VALID_LB_POLICIES.includes(meta.policy) ? meta.policy : "random";
  const policyHeaderField = typeof meta.policy_header_field === "string" ? meta.policy_header_field.trim() || null : null;
  const policyCookieName = typeof meta.policy_cookie_name === "string" ? meta.policy_cookie_name.trim() || null : null;
  const policyCookieSecret = typeof meta.policy_cookie_secret === "string" ? meta.policy_cookie_secret.trim() || null : null;
  const tryDuration = typeof meta.try_duration === "string" ? meta.try_duration.trim() || null : null;
  const tryInterval = typeof meta.try_interval === "string" ? meta.try_interval.trim() || null : null;
  const retries = typeof meta.retries === "number" && Number.isFinite(meta.retries) && meta.retries >= 0 ? meta.retries : null;

  let activeHealthCheck: LoadBalancerRouteConfig["activeHealthCheck"] = null;
  if (meta.active_health_check && meta.active_health_check.enabled) {
    activeHealthCheck = {
      enabled: true,
      uri: typeof meta.active_health_check.uri === "string" ? meta.active_health_check.uri.trim() || null : null,
      port: typeof meta.active_health_check.port === "number" && Number.isFinite(meta.active_health_check.port) && meta.active_health_check.port > 0
        ? meta.active_health_check.port
        : null,
      interval: typeof meta.active_health_check.interval === "string" ? meta.active_health_check.interval.trim() || null : null,
      timeout: typeof meta.active_health_check.timeout === "string" ? meta.active_health_check.timeout.trim() || null : null,
      status: typeof meta.active_health_check.status === "number" && Number.isFinite(meta.active_health_check.status) && meta.active_health_check.status >= 100
        ? meta.active_health_check.status
        : null,
      body: typeof meta.active_health_check.body === "string" ? meta.active_health_check.body.trim() || null : null
    };
  }

  let passiveHealthCheck: LoadBalancerRouteConfig["passiveHealthCheck"] = null;
  if (meta.passive_health_check && meta.passive_health_check.enabled) {
    const unhealthyStatus = Array.isArray(meta.passive_health_check.unhealthy_status)
      ? meta.passive_health_check.unhealthy_status.filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 100)
      : null;

    passiveHealthCheck = {
      enabled: true,
      failDuration: typeof meta.passive_health_check.fail_duration === "string" ? meta.passive_health_check.fail_duration.trim() || null : null,
      maxFails: typeof meta.passive_health_check.max_fails === "number" && Number.isFinite(meta.passive_health_check.max_fails) && meta.passive_health_check.max_fails >= 0
        ? meta.passive_health_check.max_fails
        : null,
      unhealthyStatus: unhealthyStatus && unhealthyStatus.length > 0 ? unhealthyStatus : null,
      unhealthyLatency: typeof meta.passive_health_check.unhealthy_latency === "string" ? meta.passive_health_check.unhealthy_latency.trim() || null : null
    };
  }

  return {
    enabled: true,
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

function buildLoadBalancingConfig(config: LoadBalancerRouteConfig): Record<string, unknown> | null {
  const loadBalancing: Record<string, unknown> = {};

  // Build selection policy
  const selectionPolicy: Record<string, unknown> = { policy: config.policy };

  if (config.policy === "header" && config.policyHeaderField) {
    selectionPolicy.policy = "header";
    selectionPolicy.field = config.policyHeaderField;
  } else if (config.policy === "cookie" && config.policyCookieName) {
    selectionPolicy.policy = "cookie";
    selectionPolicy.name = config.policyCookieName;
    if (config.policyCookieSecret) {
      selectionPolicy.secret = config.policyCookieSecret;
    }
  }

  loadBalancing.selection_policy = selectionPolicy;

  // Add retry settings
  if (config.tryDuration) {
    loadBalancing.try_duration = config.tryDuration;
  }
  if (config.tryInterval) {
    loadBalancing.try_interval = config.tryInterval;
  }
  if (config.retries !== null) {
    loadBalancing.retries = config.retries;
  }

  return Object.keys(loadBalancing).length > 0 ? loadBalancing : null;
}

type DnsResolverRouteConfig = {
  enabled: boolean;
  resolvers: string[];
  fallbacks: string[] | null;
  timeout: string | null;
};

function buildHealthChecksConfig(config: LoadBalancerRouteConfig): Record<string, unknown> | null {
  const healthChecks: Record<string, unknown> = {};

  // Active health checks
  if (config.activeHealthCheck && config.activeHealthCheck.enabled) {
    const active: Record<string, unknown> = {};

    if (config.activeHealthCheck.uri) {
      active.uri = config.activeHealthCheck.uri;
    }
    if (config.activeHealthCheck.port !== null) {
      active.port = config.activeHealthCheck.port;
    }
    if (config.activeHealthCheck.interval) {
      active.interval = config.activeHealthCheck.interval;
    }
    if (config.activeHealthCheck.timeout) {
      active.timeout = config.activeHealthCheck.timeout;
    }
    if (config.activeHealthCheck.status !== null) {
      active.expect_status = config.activeHealthCheck.status;
    }
    if (config.activeHealthCheck.body) {
      active.expect_body = config.activeHealthCheck.body;
    }

    if (Object.keys(active).length > 0) {
      healthChecks.active = active;
    }
  }

  // Passive health checks
  if (config.passiveHealthCheck && config.passiveHealthCheck.enabled) {
    const passive: Record<string, unknown> = {};

    if (config.passiveHealthCheck.failDuration) {
      passive.fail_duration = config.passiveHealthCheck.failDuration;
    }
    if (config.passiveHealthCheck.maxFails !== null) {
      passive.max_fails = config.passiveHealthCheck.maxFails;
    }
    if (config.passiveHealthCheck.unhealthyStatus && config.passiveHealthCheck.unhealthyStatus.length > 0) {
      passive.unhealthy_status = config.passiveHealthCheck.unhealthyStatus;
    }
    if (config.passiveHealthCheck.unhealthyLatency) {
      passive.unhealthy_latency = config.passiveHealthCheck.unhealthyLatency;
    }

    if (Object.keys(passive).length > 0) {
      healthChecks.passive = passive;
    }
  }

  return Object.keys(healthChecks).length > 0 ? healthChecks : null;
}

function parseDnsResolverConfig(meta: DnsResolverMeta | undefined | null): DnsResolverRouteConfig | null {
  if (!meta || !meta.enabled) {
    return null;
  }

  const resolvers = Array.isArray(meta.resolvers)
    ? meta.resolvers.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : [];

  if (resolvers.length === 0) {
    return null;
  }

  const fallbacks = Array.isArray(meta.fallbacks)
    ? meta.fallbacks.map((r) => (typeof r === "string" ? r.trim() : "")).filter((r) => r.length > 0)
    : null;

  const timeout = typeof meta.timeout === "string" ? meta.timeout.trim() || null : null;

  return {
    enabled: true,
    resolvers,
    fallbacks: fallbacks && fallbacks.length > 0 ? fallbacks : null,
    timeout
  };
}

function buildResolverConfig(dnsConfig: DnsResolverRouteConfig): Record<string, unknown> | null {
  if (!dnsConfig || !dnsConfig.enabled || dnsConfig.resolvers.length === 0) {
    return null;
  }

  // Build resolver addresses list (primary + fallbacks)
  // DNS resolvers need port, default to :53 if not specified
  const formatResolver = (r: string) => {
    if (r.includes(":")) return r;
    return `${r}:53`;
  };

  const addresses = dnsConfig.resolvers.map(formatResolver);
  if (dnsConfig.fallbacks && dnsConfig.fallbacks.length > 0) {
    addresses.push(...dnsConfig.fallbacks.map(formatResolver));
  }

  return { addresses };
}
