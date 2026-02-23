import { mkdirSync, writeFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import crypto from "node:crypto";
import db, { nowIso } from "./db";
import { config } from "./config";
import {
  getCloudflareSettings,
  getGeneralSettings,
  getMetricsSettings,
  getLoggingSettings,
  getDnsSettings,
  getUpstreamDnsResolutionSettings,
  getGeoBlockSettings,
  setSetting,
  type DnsSettings,
  type UpstreamDnsAddressFamily,
  type UpstreamDnsResolutionSettings,
  type GeoBlockSettings
} from "./settings";
import { syncInstances } from "./instance-sync";
import {
  accessListEntries,
  certificates,
  proxyHosts
} from "./db/schema";
import { type GeoBlockMode } from "./models/proxy-hosts";

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
  certificate_id: number | null;
  access_list_id: number | null;
  ssl_forced: number;
  hsts_enabled: number;
  hsts_subdomains: number;
  allow_websocket: number;
  preserve_host_header: number;
  skip_https_hostname_validation: number;
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

type ProxyHostMeta = {
  custom_reverse_proxy_json?: string;
  custom_pre_handlers_json?: string;
  authentik?: ProxyHostAuthentikMeta;
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
  access_list_id: number;
  username: string;
  password_hash: string;
};

type CertificateRow = {
  id: number;
  name: string;
  type: string;
  domain_names: string;
  certificate_pem: string | null;
  private_key_pem: string | null;
  auto_renew: number;
  provider_options: string | null;
};

type CaddyHttpRoute = Record<string, unknown>;

type CertificateUsage = {
  certificate: CertificateRow;
  domains: Set<string>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn("Failed to parse JSON value", value, error);
    return fallback;
  }
}

function parseOptionalJson(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("Failed to parse custom JSON", error);
    return null;
  }
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    // Block prototype-polluting keys
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      continue;
    }
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeDeep(existing, value);
    } else {
      target[key] = value;
    }
  }
}

function parseCustomHandlers(value: string | null | undefined): Record<string, unknown>[] {
  const parsed = parseOptionalJson(value);
  if (!parsed) {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const handlers: Record<string, unknown>[] = [];
  for (const item of list) {
    if (isPlainObject(item)) {
      handlers.push(item);
    } else {
      console.warn("Ignoring custom handler entry that is not an object", item);
    }
  }
  return handlers;
}

const VALID_UPSTREAM_DNS_FAMILIES: UpstreamDnsAddressFamily[] = ["ipv6", "ipv4", "both"];

type ParsedUpstreamTarget = {
  original: string;
  dial: string;
  scheme: "http" | "https" | null;
  host: string | null;
  port: string | null;
};

type UpstreamDnsResolutionRouteConfig = {
  enabled: boolean | null;
  family: UpstreamDnsAddressFamily | null;
};

type EffectiveUpstreamDnsResolution = {
  enabled: boolean;
  family: UpstreamDnsAddressFamily;
};

function formatDialAddress(host: string, port: string) {
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function parseHostPort(value: string): { host: string; port: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const closeIndex = trimmed.indexOf("]");
    if (closeIndex <= 1) {
      return null;
    }
    const host = trimmed.slice(1, closeIndex);
    const remainder = trimmed.slice(closeIndex + 1);
    if (!remainder.startsWith(":")) {
      return null;
    }
    const port = remainder.slice(1).trim();
    if (!port) {
      return null;
    }
    return { host, port };
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon === -1 || firstColon !== lastColon) {
    return null;
  }

  const host = trimmed.slice(0, lastColon).trim();
  const port = trimmed.slice(lastColon + 1).trim();
  if (!host || !port) {
    return null;
  }

  return { host, port };
}

function parseUpstreamTarget(upstream: string): ParsedUpstreamTarget {
  const trimmed = upstream.trim();
  if (!trimmed) {
    return {
      original: upstream,
      dial: upstream,
      scheme: null,
      host: null,
      port: null
    };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const scheme = url.protocol === "https:" ? "https" : "http";
      const port = url.port || (scheme === "https" ? "443" : "80");
      const host = url.hostname;
      return {
        original: trimmed,
        dial: formatDialAddress(host, port),
        scheme,
        host,
        port
      };
    }
  } catch {
    // Ignore and parse as host:port below.
  }

  const parsed = parseHostPort(trimmed);
  if (!parsed) {
    return {
      original: trimmed,
      dial: trimmed,
      scheme: null,
      host: null,
      port: null
    };
  }

  return {
    original: trimmed,
    dial: formatDialAddress(parsed.host, parsed.port),
    scheme: null,
    host: parsed.host,
    port: parsed.port
  };
}

function toDurationMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let consumed = 0;

  while (true) {
    const match = regex.exec(trimmed);
    if (!match) {
      break;
    }

    matched = true;
    consumed += match[0].length;
    const valueNum = Number.parseFloat(match[1]);
    if (!Number.isFinite(valueNum)) {
      return null;
    }
    const unit = match[2];
    if (unit === "ms") {
      total += valueNum;
    } else if (unit === "s") {
      total += valueNum * 1000;
    } else if (unit === "m") {
      total += valueNum * 60_000;
    } else if (unit === "h") {
      total += valueNum * 3_600_000;
    }
  }

  if (!matched || consumed !== trimmed.length) {
    return null;
  }

  const rounded = Math.round(total);
  return rounded > 0 ? rounded : null;
}

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

function writeCertificateFiles(cert: CertificateRow) {
  if (cert.type !== "imported" || !cert.certificate_pem || !cert.private_key_pem) {
    return null;
  }
  const certPath = join(CERTS_DIR, `certificate-${cert.id}.pem`);
  const keyPath = join(CERTS_DIR, `certificate-${cert.id}.key.pem`);
  writeFileSync(certPath, cert.certificate_pem, { encoding: "utf-8", mode: 0o600 });
  writeFileSync(keyPath, cert.private_key_pem, { encoding: "utf-8", mode: 0o600 });
  return { certificate_file: certPath, key_file: keyPath };
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

    // Handle auto-managed certificates (certificate_id is null)
    if (!row.certificate_id) {
      for (const domain of filteredDomains) {
        autoManagedDomains.add(domain);
      }
      continue;
    }

    const cert = certificates.get(row.certificate_id);
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
    response_status: host.response_status ?? global.response_status ?? 403,
    response_body: host.response_body ?? global.response_body ?? "Forbidden",
    response_headers: { ...(global.response_headers ?? {}), ...(host.response_headers ?? {}) },
    redirect_url: host.redirect_url ?? global.redirect_url ?? "",
  };
}

function resolveEffectiveGeoBlock(
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

  // Host merge mode: merge global + host
  if (hostConfig && globalConfig) {
    return mergeGeoBlockSettings(globalConfig, hostConfig);
  }

  // Only one configured
  if (hostConfig?.enabled) return hostConfig;
  if (globalConfig?.enabled) return globalConfig;

  return null;
}

function buildBlockerHandler(config: GeoBlockSettings): Record<string, unknown> {
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

  if (config.trusted_proxies?.length) handler.trusted_proxies = config.trusted_proxies;

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
};

async function buildProxyRoutes(
  rows: ProxyHostRow[],
  accessAccounts: Map<number, AccessListEntryRow[]>,
  tlsReadyCertificates: Set<number>,
  options: BuildProxyRoutesOptions
): Promise<CaddyHttpRoute[]> {
  const routes: CaddyHttpRoute[] = [];

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }

    // Allow hosts with certificate_id = null (Caddy Auto) or with valid certificate IDs
    const isAutoManaged = !row.certificate_id;
    const hasValidCertificate = row.certificate_id && tlsReadyCertificates.has(row.certificate_id);

    if (!isAutoManaged && !hasValidCertificate) {
      continue;
    }

    const domains = parseJson<string[]>(row.domains, []);
    if (domains.length === 0) {
      continue;
    }

    // Require upstreams
    const upstreams = parseJson<string[]>(row.upstreams, []);
    if (upstreams.length === 0) {
      continue;
    }

    const handlers: Record<string, unknown>[] = [];
    const meta = parseJson<ProxyHostMeta>(row.meta, {});
    const authentik = parseAuthentikConfig(meta.authentik);
    const hostRoutes: CaddyHttpRoute[] = [];

    const effectiveGeoBlock = resolveEffectiveGeoBlock(
      options.globalGeoBlock ?? null,
      { geoblock: meta.geoblock ?? null, geoblock_mode: meta.geoblock_mode ?? "merge" }
    );
    if (effectiveGeoBlock?.enabled) {
      handlers.unshift(buildBlockerHandler(effectiveGeoBlock));
    }

    if (row.hsts_enabled) {
      const value = row.hsts_subdomains ? "max-age=63072000; includeSubDomains" : "max-age=63072000";
      handlers.push({
        handler: "headers",
        response: {
          set: {
            "Strict-Transport-Security": [value]
          }
        }
      });
    }

    if (row.ssl_forced) {
      hostRoutes.push({
        match: [
          {
            host: domains,
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

    if (row.access_list_id) {
      const accounts = accessAccounts.get(row.access_list_id) ?? [];
      if (accounts.length > 0) {
        handlers.push({
          handler: "authentication",
          providers: {
            http_basic: {
              accounts: accounts.map((entry) => ({
                username: entry.username,
                password: entry.password_hash
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
      let outpostDial = authentik.outpostUpstream;
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
            host: domains,
            path: [`/${authentik.outpostDomain}/*`]
          }
        ],
        handle: [outpostHandler],
        terminal: true
      };
    }

    if (row.preserve_host_header) {
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
      const tlsTransport: Record<string, unknown> = row.skip_https_hostname_validation
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
      const healthChecks = buildHealthChecksConfig(lbConfig, dnsConfig);
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

    const customReverseProxy = parseOptionalJson(meta.custom_reverse_proxy_json);
    if (customReverseProxy) {
      if (isPlainObject(customReverseProxy)) {
        mergeDeep(reverseProxyHandler, customReverseProxy as Record<string, unknown>);
      } else {
        console.warn("Ignoring custom reverse proxy JSON because it is not an object", customReverseProxy);
      }
    }

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
        // Create separate routes for each protected path
        for (const protectedPath of authentik.protectedPaths) {
          const protectedHandlers: Record<string, unknown>[] = [...handlers];
          const protectedReverseProxy = JSON.parse(JSON.stringify(reverseProxyHandler));

          protectedHandlers.push(forwardAuthHandler);
          protectedHandlers.push(protectedReverseProxy);

          hostRoutes.push({
            match: [
              {
                host: domains,
                path: [protectedPath]
              }
            ],
            handle: protectedHandlers,
            terminal: true
          });
        }

        // Add the outpost route AFTER protected paths but BEFORE the catch-all
        // This ensures the outpost callback route is properly handled
        if (outpostRoute) {
          hostRoutes.push(outpostRoute);
        }

        // Create a catch-all route for non-protected paths (without forward auth)
        const unprotectedHandlers: Record<string, unknown>[] = [...handlers];
        unprotectedHandlers.push(reverseProxyHandler);

        hostRoutes.push({
          match: [
            {
              host: domains
            }
          ],
          handle: unprotectedHandlers,
          terminal: true
        });
      } else {
        // No path-based protection: protect entire domain (backward compatibility)
        // Add outpost route first to handle callbacks
        if (outpostRoute) {
          hostRoutes.push(outpostRoute);
        }

        handlers.push(forwardAuthHandler);
        handlers.push(reverseProxyHandler);

        const route: CaddyHttpRoute = {
          match: [
            {
              host: domains
            }
          ],
          handle: handlers,
          terminal: true
        };

        hostRoutes.push(route);
      }
    } else {
      // No Authentik: standard reverse proxy
      handlers.push(reverseProxyHandler);

      const route: CaddyHttpRoute = {
        match: [
          {
            host: domains
          }
        ],
        handle: handlers,
        terminal: true
      };

      hostRoutes.push(route);
    }

    routes.push(...hostRoutes);
  }

  return routes;
}

function buildTlsConnectionPolicies(
  usage: Map<number, CertificateUsage>,
  managedCertificatesWithAutomation: Set<number>,
  autoManagedDomains: Set<string>
) {
  const policies: Record<string, unknown>[] = [];
  const readyCertificates = new Set<number>();

  // Add policy for auto-managed domains (certificate_id = null)
  if (autoManagedDomains.size > 0) {
    const domains = Array.from(autoManagedDomains);
    policies.push({
      match: {
        sni: domains
      }
    });
  }

  for (const [id, entry] of usage.entries()) {
    const domains = Array.from(entry.domains);
    if (domains.length === 0) {
      continue;
    }

    if (entry.certificate.type === "imported") {
      const files = writeCertificateFiles(entry.certificate);
      if (!files) {
        continue;
      }
      policies.push({
        match: {
          sni: domains
        },
        certificates: [files]
      });
      readyCertificates.add(id);
      continue;
    }

    if (entry.certificate.type === "managed") {
      if (!managedCertificatesWithAutomation.has(id)) {
        continue;
      }
      policies.push({
        match: {
          sni: domains
        }
      });
      readyCertificates.add(id);
    }
  }

  return {
    policies,
    readyCertificates
  };
}

async function buildTlsAutomation(
  usage: Map<number, CertificateUsage>,
  autoManagedDomains: Set<string>,
  options: { acmeEmail?: string; dnsSettings?: DnsSettings | null }
) {
  const managedEntries = Array.from(usage.values()).filter(
    (entry) => entry.certificate.type === "managed" && Boolean(entry.certificate.auto_renew)
  );

  const hasAutoManagedDomains = autoManagedDomains.size > 0;

  if (managedEntries.length === 0 && !hasAutoManagedDomains) {
    return {
      managedCertificateIds: new Set<number>()
    };
  }

  const cloudflare = await getCloudflareSettings();
  const hasCloudflare = cloudflare && cloudflare.apiToken;

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

  // Add policy for auto-managed domains (certificate_id = null)
  if (hasAutoManagedDomains) {
    const subjects = Array.from(autoManagedDomains);

    // Build issuer configuration
    const issuer: Record<string, unknown> = {
      module: "acme"
    };

    if (options.acmeEmail) {
      issuer.email = options.acmeEmail;
    }

    // Use DNS-01 challenge if Cloudflare is configured, otherwise use HTTP-01
    if (hasCloudflare) {
      const providerConfig: Record<string, string> = {
        name: "cloudflare",
        api_token: cloudflare.apiToken
      };

      const dnsChallenge: Record<string, unknown> = {
        provider: providerConfig
      };

      // Add custom DNS resolvers if configured
      if (dnsResolvers.length > 0) {
        dnsChallenge.resolvers = dnsResolvers;
      }

      issuer.challenges = {
        dns: dnsChallenge
      };
    }

    policies.push({
      subjects,
      issuers: [issuer]
    });
  }

  // Add policies for explicitly managed certificates
  for (const entry of managedEntries) {
    const subjects = Array.from(entry.domains);
    if (subjects.length === 0) {
      continue;
    }

    managedCertificateIds.add(entry.certificate.id);

    // Build issuer configuration
    const issuer: Record<string, unknown> = {
      module: "acme"
    };

    if (options.acmeEmail) {
      issuer.email = options.acmeEmail;
    }

    // Use DNS-01 challenge if Cloudflare is configured, otherwise use HTTP-01
    if (hasCloudflare) {
      const providerConfig: Record<string, string> = {
        name: "cloudflare",
        api_token: cloudflare.apiToken
      };

      const dnsChallenge: Record<string, unknown> = {
        provider: providerConfig
      };

      // Add custom DNS resolvers if configured
      if (dnsResolvers.length > 0) {
        dnsChallenge.resolvers = dnsResolvers;
      }

      issuer.challenges = {
        dns: dnsChallenge
      };
    }

    policies.push({
      subjects,
      issuers: [issuer]
    });
  }

  if (policies.length === 0) {
    return {
      managedCertificateIds
    };
  }

  return {
    tlsApp: {
      automation: {
        policies
      }
    },
    managedCertificateIds
  };
}

async function buildCaddyDocument() {
  const [proxyHostRecords, certRows, accessListEntryRecords] = await Promise.all([
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
      .from(accessListEntries)
  ]);

  const proxyHostRows: ProxyHostRow[] = proxyHostRecords.map((h) => ({
    id: h.id,
    name: h.name,
    domains: h.domains,
    upstreams: h.upstreams,
    certificate_id: h.certificateId,
    access_list_id: h.accessListId,
    ssl_forced: h.sslForced ? 1 : 0,
    hsts_enabled: h.hstsEnabled ? 1 : 0,
    hsts_subdomains: h.hstsSubdomains ? 1 : 0,
    allow_websocket: h.allowWebsocket ? 1 : 0,
    preserve_host_header: h.preserveHostHeader ? 1 : 0,
    skip_https_hostname_validation: h.skipHttpsHostnameValidation ? 1 : 0,
    meta: h.meta,
    enabled: h.enabled ? 1 : 0
  }));

  const certRowsMapped: CertificateRow[] = certRows.map((c: typeof certRows[0]) => ({
    id: c.id,
    name: c.name,
    type: c.type as "managed" | "imported",
    domain_names: c.domainNames,
    certificate_pem: c.certificatePem,
    private_key_pem: c.privateKeyPem,
    auto_renew: c.autoRenew ? 1 : 0,
    provider_options: c.providerOptions
  }));

  const accessListEntryRows: AccessListEntryRow[] = accessListEntryRecords.map((entry) => ({
    access_list_id: entry.accessListId,
    username: entry.username,
    password_hash: entry.passwordHash
  }));

  const certificateMap = new Map(certRowsMapped.map((cert) => [cert.id, cert]));
  const accessMap = accessListEntryRows.reduce<Map<number, AccessListEntryRow[]>>((map, entry) => {
    if (!map.has(entry.access_list_id)) {
      map.set(entry.access_list_id, []);
    }
    map.get(entry.access_list_id)!.push(entry);
    return map;
  }, new Map());

  const { usage: certificateUsage, autoManagedDomains } = collectCertificateUsage(proxyHostRows, certificateMap);
  const [generalSettings, dnsSettings, upstreamDnsResolutionSettings, globalGeoBlock] = await Promise.all([
    getGeneralSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getGeoBlockSettings()
  ]);
  const { tlsApp, managedCertificateIds } = await buildTlsAutomation(certificateUsage, autoManagedDomains, {
    acmeEmail: generalSettings?.acmeEmail,
    dnsSettings
  });
  const { policies: tlsConnectionPolicies, readyCertificates } = buildTlsConnectionPolicies(
    certificateUsage,
    managedCertificateIds,
    autoManagedDomains
  );

  const httpRoutes: CaddyHttpRoute[] = await buildProxyRoutes(
    proxyHostRows,
    accessMap,
    readyCertificates,
    {
      globalDnsSettings: dnsSettings,
      globalUpstreamDnsResolutionSettings: upstreamDnsResolutionSettings,
      globalGeoBlock
    }
  );

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

  // Build logging configuration if enabled
  const loggingApp = loggingEnabled
    ? {
        logging: {
          logs: {
            http_access: {
              writer: {
                output: "file",
                filename: "/logs/access.log"
              },
              encoder: {
                format: loggingFormat
              },
              include: ["http.log.access"]
            }
          }
        }
      }
    : {};

  return {
    admin: {
      listen: "0.0.0.0:2019"
    },
    ...loggingApp,
    apps: {
      ...httpApp,
      ...(tlsApp ? { tls: tlsApp } : {})
    }
  };
}

export async function applyCaddyConfig() {
  const document = await buildCaddyDocument();
  const payload = JSON.stringify(document);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  setSetting("caddy_config_hash", { hash, updated_at: nowIso() });

  try {
    const response = await fetch(`${config.caddyApiUrl}/load`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: payload
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Caddy config load failed: ${response.status} ${text}`);
    }

    await syncInstances();
  } catch (error) {
    console.error("Failed to apply Caddy config", error);

    // Check if it's a fetch error with ECONNREFUSED or ENOTFOUND
    const err = error as { cause?: NodeJS.ErrnoException };
    const causeCode = err?.cause?.code;

    if (causeCode === "ENOTFOUND" || causeCode === "ECONNREFUSED") {
      throw new Error(`Unable to reach Caddy API at ${config.caddyApiUrl}. Ensure Caddy is running and accessible.`);
    }

    throw error;
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

  return {
    enabled: true,
    outpostDomain,
    outpostUpstream,
    authEndpoint,
    copyHeaders,
    trustedProxies,
    setOutpostHostHeader,
    protectedPaths
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

function buildHealthChecksConfig(config: LoadBalancerRouteConfig, dnsConfig: DnsResolverRouteConfig | null): Record<string, unknown> | null {
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
