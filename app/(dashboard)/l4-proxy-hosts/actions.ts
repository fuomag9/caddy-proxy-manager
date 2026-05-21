"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { actionError, actionSuccess, INITIAL_ACTION_STATE, type ActionState } from "@/src/lib/actions";
import {
  createL4ProxyHost,
  deleteL4ProxyHost,
  updateL4ProxyHost,
  type L4ProxyHostInput,
  type L4Protocol,
  type L4MatcherType,
  type L4ProxyProtocolVersion,
  type L4LoadBalancingPolicy,
  type L4LoadBalancerConfig,
  type L4DnsResolverConfig,
  type L4UpstreamDnsResolutionConfig,
  type L4GeoBlockConfig,
  type L4GeoBlockMode,
} from "@/src/lib/models/l4-proxy-hosts";
import { parseCheckbox, parseCsv, parseUpstreams, parseOptionalText, parseOptionalNumber } from "@/src/lib/form-parse";

const VALID_PROTOCOLS: L4Protocol[] = ["tcp", "udp"];
const VALID_MATCHER_TYPES: L4MatcherType[] = ["none", "tls_sni", "http_host", "proxy_protocol"];
const VALID_PP_VERSIONS: L4ProxyProtocolVersion[] = ["v1", "v2"];
const VALID_L4_LB_POLICIES: L4LoadBalancingPolicy[] = ["random", "round_robin", "least_conn", "ip_hash", "first"];
const VALID_DNS_FAMILIES = ["ipv6", "ipv4", "both"] as const;

function parseL4LoadBalancerConfig(formData: FormData): Partial<L4LoadBalancerConfig> | undefined {
  if (!formData.has("lbPresent")) return undefined;
  const enabled = formData.has("lbEnabledPresent")
    ? parseCheckbox(formData.get("lbEnabled"))
    : undefined;
  const policyRaw = parseOptionalText(formData.get("lbPolicy"));
  const policy = policyRaw && VALID_L4_LB_POLICIES.includes(policyRaw as L4LoadBalancingPolicy)
    ? (policyRaw as L4LoadBalancingPolicy) : undefined;

  const result: Partial<L4LoadBalancerConfig> = {};
  if (enabled !== undefined) result.enabled = enabled;
  if (policy) result.policy = policy;
  const tryDuration = parseOptionalText(formData.get("lbTryDuration"));
  if (tryDuration !== null) result.tryDuration = tryDuration;
  const tryInterval = parseOptionalText(formData.get("lbTryInterval"));
  if (tryInterval !== null) result.tryInterval = tryInterval;
  const retries = parseOptionalNumber(formData.get("lbRetries"));
  if (retries !== null) result.retries = retries;

  // Active health check
  if (formData.has("lbActiveHealthEnabledPresent")) {
    result.activeHealthCheck = {
      enabled: parseCheckbox(formData.get("lbActiveHealthEnabled")),
      port: parseOptionalNumber(formData.get("lbActiveHealthPort")),
      interval: parseOptionalText(formData.get("lbActiveHealthInterval")),
      timeout: parseOptionalText(formData.get("lbActiveHealthTimeout")),
    };
  }

  // Passive health check
  if (formData.has("lbPassiveHealthEnabledPresent")) {
    result.passiveHealthCheck = {
      enabled: parseCheckbox(formData.get("lbPassiveHealthEnabled")),
      failDuration: parseOptionalText(formData.get("lbPassiveHealthFailDuration")),
      maxFails: parseOptionalNumber(formData.get("lbPassiveHealthMaxFails")),
      unhealthyLatency: parseOptionalText(formData.get("lbPassiveHealthUnhealthyLatency")),
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseL4DnsResolverConfig(formData: FormData): Partial<L4DnsResolverConfig> | undefined {
  if (!formData.has("dnsPresent")) return undefined;
  const enabled = formData.has("dnsEnabledPresent")
    ? parseCheckbox(formData.get("dnsEnabled"))
    : undefined;
  const resolversRaw = parseOptionalText(formData.get("dnsResolvers"));
  const resolvers = resolversRaw
    ? resolversRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    : undefined;
  const fallbacksRaw = parseOptionalText(formData.get("dnsFallbacks"));
  const fallbacks = fallbacksRaw
    ? fallbacksRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    : undefined;
  const timeout = parseOptionalText(formData.get("dnsTimeout"));

  const result: Partial<L4DnsResolverConfig> = {};
  if (enabled !== undefined) result.enabled = enabled;
  if (resolvers) result.resolvers = resolvers;
  if (fallbacks) result.fallbacks = fallbacks;
  if (timeout !== null) result.timeout = timeout;

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseL4UpstreamDnsResolutionConfig(formData: FormData): Partial<L4UpstreamDnsResolutionConfig> | undefined {
  if (!formData.has("upstreamDnsResolutionPresent")) return undefined;
  const modeRaw = parseOptionalText(formData.get("upstreamDnsResolutionMode")) ?? "inherit";
  const familyRaw = parseOptionalText(formData.get("upstreamDnsResolutionFamily")) ?? "inherit";

  const result: Partial<L4UpstreamDnsResolutionConfig> = {};
  if (modeRaw === "enabled") result.enabled = true;
  else if (modeRaw === "disabled") result.enabled = false;
  else if (modeRaw === "inherit") result.enabled = null;

  if (familyRaw === "inherit") result.family = null;
  else if (VALID_DNS_FAMILIES.includes(familyRaw as typeof VALID_DNS_FAMILIES[number])) {
    result.family = familyRaw as "ipv6" | "ipv4" | "both";
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseL4GeoBlockConfig(formData: FormData): { geoblock: L4GeoBlockConfig | null; geoblockMode: L4GeoBlockMode } {
  if (!formData.has("geoblockPresent")) {
    return { geoblock: null, geoblockMode: "merge" };
  }
  const enabled = parseCheckbox(formData.get("geoblockEnabled"));
  const rawMode = formData.get("geoblockMode");
  const mode: L4GeoBlockMode = rawMode === "override" ? "override" : "merge";

  const parseStringList = (key: string): string[] => {
    const val = formData.get(key);
    if (!val || typeof val !== "string") return [];
    return val.split(",").map(s => s.trim()).filter(Boolean);
  };
  const parseNumberList = (key: string): number[] => {
    return parseStringList(key).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  };

  const config: L4GeoBlockConfig = {
    enabled,
    block_countries: parseStringList("geoblockBlockCountries"),
    block_continents: parseStringList("geoblockBlockContinents"),
    block_asns: parseNumberList("geoblockBlockAsns"),
    block_cidrs: parseStringList("geoblockBlockCidrs"),
    block_ips: parseStringList("geoblockBlockIps"),
    allow_countries: parseStringList("geoblockAllowCountries"),
    allow_continents: parseStringList("geoblockAllowContinents"),
    allow_asns: parseNumberList("geoblockAllowAsns"),
    allow_cidrs: parseStringList("geoblockAllowCidrs"),
    allow_ips: parseStringList("geoblockAllowIps"),
  };
  return { geoblock: config, geoblockMode: mode };
}

function parseProtocol(formData: FormData): L4Protocol {
  const raw = String(formData.get("protocol") ?? "tcp").trim().toLowerCase();
  if (VALID_PROTOCOLS.includes(raw as L4Protocol)) return raw as L4Protocol;
  return "tcp";
}

function parseMatcherType(formData: FormData): L4MatcherType {
  const raw = String(formData.get("matcherType") ?? "none").trim();
  if (VALID_MATCHER_TYPES.includes(raw as L4MatcherType)) return raw as L4MatcherType;
  return "none";
}

function parseProxyProtocolVersion(formData: FormData): L4ProxyProtocolVersion | null {
  const raw = parseOptionalText(formData.get("proxyProtocolVersion"));
  if (raw && VALID_PP_VERSIONS.includes(raw as L4ProxyProtocolVersion)) return raw as L4ProxyProtocolVersion;
  return null;
}

export async function createL4ProxyHostAction(
  _prevState: ActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<ActionState> {
  void _prevState;
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);

    const matcherType = parseMatcherType(formData);
    const matcherValue = (matcherType === "tls_sni" || matcherType === "http_host")
      ? parseCsv(formData.get("matcherValue"))
      : [];

    const input: L4ProxyHostInput = {
      name: String(formData.get("name") ?? "Untitled"),
      protocol: parseProtocol(formData),
      listenAddress: String(formData.get("listenAddress") ?? "").trim(),
      upstreams: parseUpstreams(formData.get("upstreams")),
      matcherType: matcherType,
      matcherValue: matcherValue,
      tlsTermination: parseCheckbox(formData.get("tlsTermination")),
      proxyProtocolVersion: parseProxyProtocolVersion(formData),
      proxyProtocolReceive: parseCheckbox(formData.get("proxyProtocolReceive")),
      enabled: parseCheckbox(formData.get("enabled")),
      loadBalancer: parseL4LoadBalancerConfig(formData),
      dnsResolver: parseL4DnsResolverConfig(formData),
      upstreamDnsResolution: parseL4UpstreamDnsResolutionConfig(formData),
      ...parseL4GeoBlockConfig(formData),
    };

    await createL4ProxyHost(input, userId);
    revalidatePath("/l4-proxy-hosts");
    return actionSuccess("L4 proxy host created and queued for Caddy reload.");
  } catch (error) {
    console.error("Failed to create L4 proxy host:", error);
    return actionError(error, "Failed to create L4 proxy host.");
  }
}

export async function updateL4ProxyHostAction(
  id: number,
  _prevState: ActionState = INITIAL_ACTION_STATE,
  formData: FormData
): Promise<ActionState> {
  void _prevState;
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);

    const matcherType = parseMatcherType(formData);
    const matcherValue = (matcherType === "tls_sni" || matcherType === "http_host")
      ? parseCsv(formData.get("matcherValue"))
      : [];

    const input: Partial<L4ProxyHostInput> = {
      name: formData.get("name") ? String(formData.get("name")) : undefined,
      protocol: parseProtocol(formData),
      listenAddress: formData.get("listenAddress") ? String(formData.get("listenAddress")).trim() : undefined,
      upstreams: formData.get("upstreams") ? parseUpstreams(formData.get("upstreams")) : undefined,
      matcherType: matcherType,
      matcherValue: matcherValue,
      tlsTermination: parseCheckbox(formData.get("tlsTermination")),
      proxyProtocolVersion: parseProxyProtocolVersion(formData),
      proxyProtocolReceive: parseCheckbox(formData.get("proxyProtocolReceive")),
      enabled: formData.has("enabledPresent") ? parseCheckbox(formData.get("enabled")) : undefined,
      loadBalancer: parseL4LoadBalancerConfig(formData),
      dnsResolver: parseL4DnsResolverConfig(formData),
      upstreamDnsResolution: parseL4UpstreamDnsResolutionConfig(formData),
      ...parseL4GeoBlockConfig(formData),
    };

    await updateL4ProxyHost(id, input, userId);
    revalidatePath("/l4-proxy-hosts");
    return actionSuccess("L4 proxy host updated.");
  } catch (error) {
    console.error(`Failed to update L4 proxy host ${id}:`, error);
    return actionError(error, "Failed to update L4 proxy host.");
  }
}

export async function deleteL4ProxyHostAction(
  id: number,
  _prevState: ActionState = INITIAL_ACTION_STATE
): Promise<ActionState> {
  void _prevState;
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    await deleteL4ProxyHost(id, userId);
    revalidatePath("/l4-proxy-hosts");
    return actionSuccess("L4 proxy host deleted.");
  } catch (error) {
    console.error(`Failed to delete L4 proxy host ${id}:`, error);
    return actionError(error, "Failed to delete L4 proxy host.");
  }
}

export async function toggleL4ProxyHostAction(
  id: number,
  enabled: boolean
): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    await updateL4ProxyHost(id, { enabled }, userId);
    revalidatePath("/l4-proxy-hosts");
    return actionSuccess(`L4 proxy host ${enabled ? "enabled" : "disabled"}.`);
  } catch (error) {
    console.error(`Failed to toggle L4 proxy host ${id}:`, error);
    return actionError(error, "Failed to toggle L4 proxy host.");
  }
}
