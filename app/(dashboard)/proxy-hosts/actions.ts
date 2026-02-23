"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { actionError, actionSuccess, INITIAL_ACTION_STATE, type ActionState } from "@/src/lib/actions";
import {
  createProxyHost,
  deleteProxyHost,
  updateProxyHost,
  type ProxyHostAuthentikInput,
  type LoadBalancerInput,
  type LoadBalancingPolicy,
  type DnsResolverInput,
  type UpstreamDnsResolutionInput,
  type GeoBlockMode
} from "@/src/lib/models/proxy-hosts";
import { getCertificate } from "@/src/lib/models/certificates";
import { getCloudflareSettings, type GeoBlockSettings } from "@/src/lib/settings";

function parseCsv(value: FormDataEntryValue | null): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Parse upstreams by newline only (URLs may contain commas in query strings)
function parseUpstreams(value: FormDataEntryValue | null): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCheckbox(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function parseOptionalText(value: FormDataEntryValue | null): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCertificateId(value: FormDataEntryValue | null): number | null {
  if (!value || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
    return null;
  }

  const num = Number(trimmed);

  // Check for NaN, Infinity, or non-integer values
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    return null;
  }

  return num;
}

async function validateAndSanitizeCertificateId(
  certificateId: number | null,
  cloudflareConfigured: boolean
): Promise<{ certificateId: number | null; warning?: string }> {
  // null is valid (Caddy Auto)
  if (certificateId === null) {
    return { certificateId: null };
  }

  // Check if certificate exists
  const certificate = await getCertificate(certificateId);

  if (!certificate) {
    // Build helpful warning message
    let warning: string;

    if (!cloudflareConfigured) {
      warning = `Certificate ID ${certificateId} not found. Automatically using 'Managed by Caddy (Auto)'. Note: Without Cloudflare DNS integration, wildcard certificates require port 80 to be accessible for HTTP-01 challenges. Configure Cloudflare in Settings to enable DNS-01 challenges.`;
    } else {
      warning = `Certificate ID ${certificateId} not found. Automatically using 'Managed by Caddy (Auto)' which will provision certificates automatically using Caddy.`;
    }

    return { certificateId: null, warning };
  }

  return { certificateId };
}

function parseAuthentikConfig(formData: FormData): ProxyHostAuthentikInput | undefined {
  if (!formData.has("authentik_present")) {
    return undefined;
  }

  const enabledIndicator = formData.has("authentik_enabled_present");
  const enabledValue = enabledIndicator
    ? formData.has("authentik_enabled")
      ? parseCheckbox(formData.get("authentik_enabled"))
      : false
    : undefined;
  const outpostDomain = parseOptionalText(formData.get("authentik_outpost_domain"));
  const outpostUpstream = parseOptionalText(formData.get("authentik_outpost_upstream"));
  const authEndpoint = parseOptionalText(formData.get("authentik_auth_endpoint"));
  const copyHeaders = parseCsv(formData.get("authentik_copy_headers"));
  const trustedProxies = parseCsv(formData.get("authentik_trusted_proxies"));
  const protectedPaths = parseCsv(formData.get("authentik_protected_paths"));
  const setHostHeader = formData.has("authentik_set_host_header_present")
    ? parseCheckbox(formData.get("authentik_set_host_header"))
    : undefined;

  const result: ProxyHostAuthentikInput = {};
  if (enabledValue !== undefined) {
    result.enabled = enabledValue;
  }
  if (outpostDomain !== null) {
    result.outpostDomain = outpostDomain;
  }
  if (outpostUpstream !== null) {
    result.outpostUpstream = outpostUpstream;
  }
  if (authEndpoint !== null) {
    result.authEndpoint = authEndpoint;
  }
  if (copyHeaders.length > 0 || formData.has("authentik_copy_headers")) {
    result.copyHeaders = copyHeaders;
  }
  if (trustedProxies.length > 0 || formData.has("authentik_trusted_proxies")) {
    result.trustedProxies = trustedProxies;
  }
  if (protectedPaths.length > 0 || formData.has("authentik_protected_paths")) {
    result.protectedPaths = protectedPaths;
  }
  if (setHostHeader !== undefined) {
    result.setOutpostHostHeader = setHostHeader;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

const VALID_LB_POLICIES: LoadBalancingPolicy[] = ["random", "round_robin", "least_conn", "ip_hash", "first", "header", "cookie", "uri_hash"];
const VALID_UPSTREAM_DNS_FAMILIES = ["ipv6", "ipv4", "both"] as const;

function parseLoadBalancerConfig(formData: FormData): LoadBalancerInput | undefined {
  if (!formData.has("lb_present")) {
    return undefined;
  }

  const enabledIndicator = formData.has("lb_enabled_present");
  const enabledValue = enabledIndicator
    ? formData.has("lb_enabled")
      ? parseCheckbox(formData.get("lb_enabled"))
      : false
    : undefined;

  const policyRaw = parseOptionalText(formData.get("lb_policy"));
  const policy = policyRaw && VALID_LB_POLICIES.includes(policyRaw as LoadBalancingPolicy)
    ? (policyRaw as LoadBalancingPolicy)
    : undefined;

  const policyHeaderField = parseOptionalText(formData.get("lb_policy_header_field"));
  const policyCookieName = parseOptionalText(formData.get("lb_policy_cookie_name"));
  const policyCookieSecret = parseOptionalText(formData.get("lb_policy_cookie_secret"));
  const tryDuration = parseOptionalText(formData.get("lb_try_duration"));
  const tryInterval = parseOptionalText(formData.get("lb_try_interval"));
  const retries = parseOptionalNumber(formData.get("lb_retries"));

  // Active health check
  const activeHealthEnabled = formData.has("lb_active_health_enabled_present")
    ? formData.has("lb_active_health_enabled")
      ? parseCheckbox(formData.get("lb_active_health_enabled"))
      : false
    : undefined;

  let activeHealthCheck: LoadBalancerInput["activeHealthCheck"] = undefined;
  if (activeHealthEnabled !== undefined || formData.has("lb_active_health_uri")) {
    activeHealthCheck = {
      enabled: activeHealthEnabled,
      uri: parseOptionalText(formData.get("lb_active_health_uri")),
      port: parseOptionalNumber(formData.get("lb_active_health_port")),
      interval: parseOptionalText(formData.get("lb_active_health_interval")),
      timeout: parseOptionalText(formData.get("lb_active_health_timeout")),
      status: parseOptionalNumber(formData.get("lb_active_health_status")),
      body: parseOptionalText(formData.get("lb_active_health_body"))
    };
  }

  // Passive health check
  const passiveHealthEnabled = formData.has("lb_passive_health_enabled_present")
    ? formData.has("lb_passive_health_enabled")
      ? parseCheckbox(formData.get("lb_passive_health_enabled"))
      : false
    : undefined;

  let passiveHealthCheck: LoadBalancerInput["passiveHealthCheck"] = undefined;
  if (passiveHealthEnabled !== undefined || formData.has("lb_passive_health_fail_duration")) {
    // Parse unhealthy status codes from comma-separated input
    const unhealthyStatusRaw = parseOptionalText(formData.get("lb_passive_health_unhealthy_status"));
    let unhealthyStatus: number[] | null = null;
    if (unhealthyStatusRaw) {
      unhealthyStatus = unhealthyStatusRaw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 100);
      if (unhealthyStatus.length === 0) {
        unhealthyStatus = null;
      }
    }

    passiveHealthCheck = {
      enabled: passiveHealthEnabled,
      failDuration: parseOptionalText(formData.get("lb_passive_health_fail_duration")),
      maxFails: parseOptionalNumber(formData.get("lb_passive_health_max_fails")),
      unhealthyStatus,
      unhealthyLatency: parseOptionalText(formData.get("lb_passive_health_unhealthy_latency"))
    };
  }

  const result: LoadBalancerInput = {};
  if (enabledValue !== undefined) {
    result.enabled = enabledValue;
  }
  if (policy !== undefined) {
    result.policy = policy;
  }
  if (policyHeaderField !== null) {
    result.policyHeaderField = policyHeaderField;
  }
  if (policyCookieName !== null) {
    result.policyCookieName = policyCookieName;
  }
  if (policyCookieSecret !== null) {
    result.policyCookieSecret = policyCookieSecret;
  }
  if (tryDuration !== null) {
    result.tryDuration = tryDuration;
  }
  if (tryInterval !== null) {
    result.tryInterval = tryInterval;
  }
  if (retries !== null) {
    result.retries = retries;
  }
  if (activeHealthCheck !== undefined) {
    result.activeHealthCheck = activeHealthCheck;
  }
  if (passiveHealthCheck !== undefined) {
    result.passiveHealthCheck = passiveHealthCheck;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseGeoBlockConfig(formData: FormData): {
  geoblock: GeoBlockSettings | null;
  geoblock_mode: GeoBlockMode;
} {
  if (!formData.has("geoblock_present")) {
    return { geoblock: null, geoblock_mode: "merge" };
  }

  const enabled = parseCheckbox(formData.get("geoblock_enabled"));
  const mode = (formData.get("geoblock_mode") ?? "merge") as GeoBlockMode;

  // Helper to parse a comma-separated string field into a string array
  const parseStringList = (key: string): string[] => {
    const val = formData.get(key);
    if (!val || typeof val !== "string") return [];
    return val.split(",").map(s => s.trim()).filter(Boolean);
  };

  // Helper to parse a comma-separated string field into a number array
  const parseNumberList = (key: string): number[] => {
    return parseStringList(key)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n));
  };

  const config: GeoBlockSettings = {
    enabled,
    block_countries: parseStringList("geoblock_block_countries"),
    block_continents: parseStringList("geoblock_block_continents"),
    block_asns: parseNumberList("geoblock_block_asns"),
    block_cidrs: parseStringList("geoblock_block_cidrs"),
    block_ips: parseStringList("geoblock_block_ips"),
    allow_countries: parseStringList("geoblock_allow_countries"),
    allow_continents: parseStringList("geoblock_allow_continents"),
    allow_asns: parseNumberList("geoblock_allow_asns"),
    allow_cidrs: parseStringList("geoblock_allow_cidrs"),
    allow_ips: parseStringList("geoblock_allow_ips"),
    trusted_proxies: parseStringList("geoblock_trusted_proxies"),
    response_status: parseOptionalNumber(formData.get("geoblock_response_status")) ?? 403,
    response_body: parseOptionalText(formData.get("geoblock_response_body")) ?? "Forbidden",
    response_headers: parseResponseHeaders(formData),
    redirect_url: parseOptionalText(formData.get("geoblock_redirect_url")) ?? "",
  };

  return { geoblock: config, geoblock_mode: mode };
}

// Helper: parse response headers from geoblock_response_headers_keys[] and geoblock_response_headers_values[]
function parseResponseHeaders(formData: FormData): Record<string, string> {
  const keys = formData.getAll("geoblock_response_headers_keys[]") as string[];
  const values = formData.getAll("geoblock_response_headers_values[]") as string[];
  const headers: Record<string, string> = {};
  keys.forEach((key, i) => {
    const trimmed = key.trim();
    if (trimmed) headers[trimmed] = (values[i] ?? "").trim();
  });
  return headers;
}

function parseDnsResolverConfig(formData: FormData): DnsResolverInput | undefined {
  if (!formData.has("dns_present")) {
    return undefined;
  }

  const enabledIndicator = formData.has("dns_enabled_present");
  const enabledValue = enabledIndicator
    ? formData.has("dns_enabled")
      ? parseCheckbox(formData.get("dns_enabled"))
      : false
    : undefined;

  // Parse resolvers from newline-separated input
  const resolversRaw = parseOptionalText(formData.get("dns_resolvers"));
  let resolvers: string[] | undefined = undefined;
  if (resolversRaw || formData.has("dns_resolvers")) {
    resolvers = resolversRaw
      ? resolversRaw
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  }

  // Parse fallbacks from newline-separated input
  const fallbacksRaw = parseOptionalText(formData.get("dns_fallbacks"));
  let fallbacks: string[] | null = null;
  if (fallbacksRaw) {
    fallbacks = fallbacksRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (fallbacks.length === 0) {
      fallbacks = null;
    }
  }

  const timeout = parseOptionalText(formData.get("dns_timeout"));

  const result: DnsResolverInput = {};
  if (enabledValue !== undefined) {
    result.enabled = enabledValue;
  }
  if (resolvers !== undefined) {
    result.resolvers = resolvers;
  }
  if (fallbacks !== null) {
    result.fallbacks = fallbacks;
  }
  if (timeout !== null) {
    result.timeout = timeout;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseUpstreamDnsResolutionConfig(formData: FormData): UpstreamDnsResolutionInput | undefined {
  if (!formData.has("upstream_dns_resolution_present")) {
    return undefined;
  }

  const modeRaw = parseOptionalText(formData.get("upstream_dns_resolution_mode")) ?? "inherit";
  const familyRaw = parseOptionalText(formData.get("upstream_dns_resolution_family")) ?? "inherit";

  const result: UpstreamDnsResolutionInput = {};

  if (modeRaw === "enabled") {
    result.enabled = true;
  } else if (modeRaw === "disabled") {
    result.enabled = false;
  } else if (modeRaw === "inherit") {
    result.enabled = null;
  }

  if (familyRaw === "inherit") {
    result.family = null;
  } else if (VALID_UPSTREAM_DNS_FAMILIES.includes(familyRaw as typeof VALID_UPSTREAM_DNS_FAMILIES[number])) {
    result.family = familyRaw as "ipv6" | "ipv4" | "both";
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export async function createProxyHostAction(
  _prevState: ActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);

    // Parse certificate_id safely
    const parsedCertificateId = parseCertificateId(formData.get("certificate_id"));

    // Validate certificate exists and get sanitized value
    const cloudflareSettings = await getCloudflareSettings();
    const cloudflareConfigured = !!(cloudflareSettings?.apiToken);

    const { certificateId, warning } = await validateAndSanitizeCertificateId(parsedCertificateId, cloudflareConfigured);

    // Log warning if certificate was auto-fallback
    if (warning) {
      console.warn(`[createProxyHostAction] ${warning}`);
    }

    await createProxyHost(
      {
        name: String(formData.get("name") ?? "Untitled"),
        domains: parseCsv(formData.get("domains")),
        upstreams: parseUpstreams(formData.get("upstreams")),
        certificate_id: certificateId,
        access_list_id: formData.get("access_list_id") ? Number(formData.get("access_list_id")) : null,
        hsts_subdomains: parseCheckbox(formData.get("hsts_subdomains")),
        skip_https_hostname_validation: parseCheckbox(formData.get("skip_https_hostname_validation")),
        enabled: parseCheckbox(formData.get("enabled")),
        custom_pre_handlers_json: parseOptionalText(formData.get("custom_pre_handlers_json")),
        custom_reverse_proxy_json: parseOptionalText(formData.get("custom_reverse_proxy_json")),
        authentik: parseAuthentikConfig(formData),
        load_balancer: parseLoadBalancerConfig(formData),
        dns_resolver: parseDnsResolverConfig(formData),
        upstream_dns_resolution: parseUpstreamDnsResolutionConfig(formData),
        ...parseGeoBlockConfig(formData)
      },
      userId
    );
    revalidatePath("/proxy-hosts");

    // Return success with warning if applicable
    if (warning) {
      return actionSuccess(`Proxy host created using Caddy Auto certificate management. ${warning}`);
    }
    return actionSuccess("Proxy host created and queued for Caddy reload.");
  } catch (error) {
    console.error("Failed to create proxy host:", error);
    return actionError(error, "Failed to create proxy host. Please check the logs for details.");
  }
}

export async function updateProxyHostAction(
  id: number,
  _prevState: ActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    const boolField = (key: string) => (formData.has(`${key}_present`) ? parseCheckbox(formData.get(key)) : undefined);

    // Parse and validate certificate_id if present
    let certificateId: number | null | undefined = undefined;
    let warning: string | undefined;

    if (formData.has("certificate_id")) {
      const parsedCertificateId = parseCertificateId(formData.get("certificate_id"));

      // Validate certificate exists and get sanitized value
      const cloudflareSettings = await getCloudflareSettings();
      const cloudflareConfigured = !!(cloudflareSettings?.apiToken);

      const validation = await validateAndSanitizeCertificateId(parsedCertificateId, cloudflareConfigured);
      certificateId = validation.certificateId;
      warning = validation.warning;

      // Log warning if certificate was auto-fallback
      if (warning) {
        console.warn(`[updateProxyHostAction] ${warning}`);
      }
    }

    await updateProxyHost(
      id,
      {
        name: formData.get("name") ? String(formData.get("name")) : undefined,
        domains: formData.get("domains") ? parseCsv(formData.get("domains")) : undefined,
        upstreams: formData.get("upstreams") ? parseUpstreams(formData.get("upstreams")) : undefined,
        certificate_id: certificateId,
        access_list_id: formData.has("access_list_id")
          ? (formData.get("access_list_id") ? Number(formData.get("access_list_id")) : null)
          : undefined,
        hsts_subdomains: boolField("hsts_subdomains"),
        skip_https_hostname_validation: boolField("skip_https_hostname_validation"),
        enabled: boolField("enabled"),
        custom_pre_handlers_json: formData.has("custom_pre_handlers_json")
          ? parseOptionalText(formData.get("custom_pre_handlers_json"))
          : undefined,
        custom_reverse_proxy_json: formData.has("custom_reverse_proxy_json")
          ? parseOptionalText(formData.get("custom_reverse_proxy_json"))
          : undefined,
        authentik: parseAuthentikConfig(formData),
        load_balancer: parseLoadBalancerConfig(formData),
        dns_resolver: parseDnsResolverConfig(formData),
        upstream_dns_resolution: parseUpstreamDnsResolutionConfig(formData),
        ...parseGeoBlockConfig(formData)
      },
      userId
    );
    revalidatePath("/proxy-hosts");

    // Return success with warning if applicable
    if (warning) {
      return actionSuccess(`Proxy host updated using Caddy Auto certificate management. ${warning}`);
    }
    return actionSuccess("Proxy host updated.");
  } catch (error) {
    console.error(`Failed to update proxy host ${id}:`, error);
    return actionError(error, "Failed to update proxy host. Please check the logs for details.");
  }
}

export async function deleteProxyHostAction(
  id: number,
  _prevState: ActionState = INITIAL_ACTION_STATE
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    await deleteProxyHost(id, userId);
    revalidatePath("/proxy-hosts");
    return actionSuccess("Proxy host deleted.");
  } catch (error) {
    console.error(`Failed to delete proxy host ${id}:`, error);
    return actionError(error, "Failed to delete proxy host. Please check the logs for details.");
  }
}

export async function toggleProxyHostAction(
  id: number,
  enabled: boolean
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    await updateProxyHost(id, { enabled }, userId);
    revalidatePath("/proxy-hosts");
    return actionSuccess(`Proxy host ${enabled ? "enabled" : "disabled"}.`);
  } catch (error) {
    console.error(`Failed to toggle proxy host ${id}:`, error);
    return actionError(error, "Failed to toggle proxy host. Please check the logs for details.");
  }
}
