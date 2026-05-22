"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { getInstanceMode, getSlaveMasterToken, setInstanceMode, setSlaveMasterToken, syncInstances } from "@/src/lib/instance-sync";
import { createInstance, deleteInstance, updateInstance } from "@/src/lib/models/instances";
import { clearSetting, getSetting, saveCloudflareSettings, getDnsProviderSettings, saveDnsProviderSettings, saveGeneralSettings, saveAuthentikSettings, saveMetricsSettings, saveLoggingSettings, saveDnsSettings, saveUpstreamDnsResolutionSettings, saveGeoBlockSettings, saveWafSettings, getWafSettings } from "@/src/lib/settings";
import { listProxyHosts, updateProxyHost } from "@/src/lib/models/proxy-hosts";
import { getWafRuleMessages } from "@/src/lib/models/waf-events";
import type { CloudflareSettings, DnsProviderSettings, GeoBlockSettings, WafSettings } from "@/src/lib/settings";
import { getProviderDefinition, encryptProviderCredentials } from "@/src/lib/dns-providers";

type ActionResult = {
  success: boolean;
  message?: string;
};

const MIN_TOKEN_LENGTH = 32;
const VALID_UPSTREAM_DNS_FAMILIES = ["ipv6", "ipv4", "both"] as const;

/**
 * Validates that a sync token meets minimum security requirements.
 * Tokens must be at least 32 characters to provide adequate entropy.
 */
function validateSyncToken(token: string): { valid: boolean; error?: string } {
  if (token.length < MIN_TOKEN_LENGTH) {
    return {
      valid: false,
      error: `Token must be at least ${MIN_TOKEN_LENGTH} characters for security. Consider using a randomly generated token.`
    };
  }
  return { valid: true };
}

export async function updateGeneralSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("general");
      await syncInstances();
      revalidatePath("/settings");
      return { success: true, message: "General settings reset to master defaults" };
    }
    await saveGeneralSettings({
      primaryDomain: String(formData.get("primaryDomain") ?? ""),
      acmeEmail: formData.get("acmeEmail") ? String(formData.get("acmeEmail")) : undefined
    });
    await syncInstances();
    revalidatePath("/settings");
    return { success: true, message: "General settings saved successfully" };
  } catch (error) {
    console.error("Failed to save general settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save general settings" };
  }
}

export async function updateCloudflareSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("cloudflare");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "Cloudflare settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return {
          success: true,
          message: `Settings reset, but could not apply to Caddy: ${errorMsg}`
        };
      }
    }
    const rawToken = formData.get("apiToken") ? String(formData.get("apiToken")).trim() : "";
    const clearToken = formData.get("clearToken") === "on";
    const current = await getSetting<CloudflareSettings>("cloudflare");

    const apiToken = clearToken ? "" : rawToken || current?.apiToken || "";
    const zoneId = formData.get("zoneId") ? String(formData.get("zoneId")) : undefined;
    const accountId = formData.get("accountId") ? String(formData.get("accountId")) : undefined;

    await saveCloudflareSettings({
      apiToken,
      zoneId: zoneId && zoneId.length > 0 ? zoneId : undefined,
      accountId: accountId && accountId.length > 0 ? accountId : undefined
    });

    // Try to apply the config, but don't fail if Caddy is unreachable
    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "Cloudflare settings saved and applied to Caddy successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true, // Settings were saved successfully
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}. You may need to start Caddy or check your configuration.`
      };
    }
  } catch (error) {
    console.error("Failed to save Cloudflare settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save Cloudflare settings" };
  }
}

export async function updateDnsProviderSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("dns_provider");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "DNS provider settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return { success: true, message: `Settings reset, but could not apply to Caddy: ${errorMsg}` };
      }
    }

    const action = String(formData.get("action") ?? "save").trim();
    const providerName = String(formData.get("provider") ?? "").trim();
    const current = await getDnsProviderSettings();
    const settings: DnsProviderSettings = current ?? { providers: {}, default: null };

    if (action === "remove") {
      if (!providerName || !settings.providers[providerName]) {
        return { success: false, message: "No provider to remove" };
      }
      const def = getProviderDefinition(providerName);
      delete settings.providers[providerName];
      if (settings.default === providerName) {
        // Pick next configured provider, or null
        const remaining = Object.keys(settings.providers);
        settings.default = remaining.length > 0 ? remaining[0] : null;
      }
      await saveDnsProviderSettings(settings);
      await syncInstances();
      try { await applyCaddyConfig(); } catch { /* non-fatal */ }
      revalidatePath("/settings");
      return { success: true, message: `${def?.displayName ?? providerName} removed${settings.default ? `. Default is now ${settings.default}.` : "."}` };
    }

    if (action === "set-default") {
      const newDefault = providerName === "none" ? null : providerName;
      if (newDefault && !settings.providers[newDefault]) {
        return { success: false, message: `Cannot set default: ${providerName} is not configured` };
      }
      settings.default = newDefault;
      await saveDnsProviderSettings(settings);
      await syncInstances();
      try { await applyCaddyConfig(); } catch { /* non-fatal */ }
      revalidatePath("/settings");
      const label = newDefault ? (getProviderDefinition(newDefault)?.displayName ?? newDefault) : "None";
      return { success: true, message: `Default DNS provider set to ${label}` };
    }

    // action === "save": add or update a provider's credentials
    if (!providerName || providerName === "none") {
      return { success: false, message: "Select a provider to configure" };
    }

    const def = getProviderDefinition(providerName);
    if (!def) {
      return { success: false, message: `Unknown DNS provider: ${providerName}` };
    }

    const existingCreds = settings.providers[providerName];

    // Collect credentials from form
    const credentials: Record<string, string> = {};
    for (const field of def.fields) {
      const rawValue = formData.get(`credential_${field.key}`);
      const value = rawValue ? String(rawValue).trim() : "";
      if (value) {
        credentials[field.key] = value;
      } else if (existingCreds?.[field.key]) {
        credentials[field.key] = existingCreds[field.key];
      }
    }

    // Validate required fields
    for (const field of def.fields) {
      if (field.required && !credentials[field.key]) {
        return { success: false, message: `${field.label} is required for ${def.displayName}` };
      }
    }

    // Encrypt password fields before storing
    settings.providers[providerName] = encryptProviderCredentials(providerName, credentials);

    // If this is the first provider, make it the default
    if (!settings.default) {
      settings.default = providerName;
    }

    await saveDnsProviderSettings(settings);
    await syncInstances();

    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      const isDefault = settings.default === providerName;
      return { success: true, message: `${def.displayName} saved${isDefault ? " (default)" : ""}` };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return { success: true, message: `Settings saved, but could not apply to Caddy: ${errorMsg}` };
    }
  } catch (error) {
    console.error("Failed to save DNS provider settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save DNS provider settings" };
  }
}

export async function updateAuthentikSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("authentik");
      await syncInstances();
      revalidatePath("/settings");
      return { success: true, message: "Authentik defaults reset to master values" };
    }
    const outpostDomain = String(formData.get("outpostDomain") ?? "").trim();
    const outpostUpstream = String(formData.get("outpostUpstream") ?? "").trim();
    const authEndpoint = formData.get("authEndpoint") ? String(formData.get("authEndpoint")).trim() : undefined;

    if (!outpostDomain || !outpostUpstream) {
      return { success: false, message: "Outpost domain and upstream are required" };
    }

    await saveAuthentikSettings({
      outpostDomain,
      outpostUpstream,
      authEndpoint: authEndpoint && authEndpoint.length > 0 ? authEndpoint : undefined
    });

    await syncInstances();
    revalidatePath("/settings");
    return { success: true, message: "Authentik defaults saved successfully" };
  } catch (error) {
    console.error("Failed to save Authentik settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save Authentik settings" };
  }
}

export async function updateMetricsSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("metrics");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "Metrics settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return {
          success: true,
          message: `Settings reset, but could not apply to Caddy: ${errorMsg}`
        };
      }
    }
    const enabled = formData.get("enabled") === "on";
    const portStr = formData.get("port") ? String(formData.get("port")).trim() : "";
    const port = portStr && !isNaN(Number(portStr)) ? Number(portStr) : 9090;

    await saveMetricsSettings({
      enabled,
      port
    });

    // Apply config to enable/disable metrics
    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "Metrics settings saved and applied successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true,
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}`
      };
    }
  } catch (error) {
    console.error("Failed to save metrics settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save metrics settings" };
  }
}

export async function updateLoggingSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("logging");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "Logging settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return {
          success: true,
          message: `Settings reset, but could not apply to Caddy: ${errorMsg}`
        };
      }
    }
    const enabled = formData.get("enabled") === "on";
    const format = formData.get("format") ? String(formData.get("format")).trim() : "json";

    // Validate format
    if (format !== "json" && format !== "console") {
      return { success: false, message: "Invalid log format. Must be 'json' or 'console'" };
    }

    await saveLoggingSettings({
      enabled,
      format: format as "json" | "console"
    });

    // Apply config to enable/disable logging
    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "Logging settings saved and applied successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true,
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}`
      };
    }
  } catch (error) {
    console.error("Failed to save logging settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save logging settings" };
  }
}

function parseResolverList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function updateDnsSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("dns");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "DNS settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return {
          success: true,
          message: `Settings reset, but could not apply to Caddy: ${errorMsg}`
        };
      }
    }
    const enabled = formData.get("enabled") === "on";
    const resolversRaw = formData.get("resolvers") ? String(formData.get("resolvers")) : "";
    const fallbacksRaw = formData.get("fallbacks") ? String(formData.get("fallbacks")) : "";
    const timeout = formData.get("timeout") ? String(formData.get("timeout")).trim() : undefined;

    const resolvers = parseResolverList(resolversRaw);
    const fallbacks = parseResolverList(fallbacksRaw);

    if (enabled && resolvers.length === 0) {
      return { success: false, message: "At least one DNS resolver is required when enabled" };
    }

    await saveDnsSettings({
      enabled,
      resolvers,
      fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
      timeout: timeout && timeout.length > 0 ? timeout : undefined
    });

    // Apply config to use new DNS resolvers
    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "DNS settings saved and applied successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true,
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}`
      };
    }
  } catch (error) {
    console.error("Failed to save DNS settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save DNS settings" };
  }
}

export async function updateUpstreamDnsResolutionSettingsAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    const overrideEnabled = formData.get("overrideEnabled") === "on";
    if (mode === "slave" && !overrideEnabled) {
      await clearSetting("upstream_dns_resolution");
      try {
        await applyCaddyConfig();
        revalidatePath("/settings");
        return { success: true, message: "Upstream DNS resolution settings reset to master defaults" };
      } catch (error) {
        console.error("Failed to apply Caddy config:", error);
        revalidatePath("/settings");
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await syncInstances();
        return {
          success: true,
          message: `Settings reset, but could not apply to Caddy: ${errorMsg}`
        };
      }
    }

    const enabled = formData.get("enabled") === "on";
    const familyRaw = formData.get("family") ? String(formData.get("family")).trim() : "both";
    if (!VALID_UPSTREAM_DNS_FAMILIES.includes(familyRaw as typeof VALID_UPSTREAM_DNS_FAMILIES[number])) {
      return { success: false, message: "Invalid address family selection" };
    }

    await saveUpstreamDnsResolutionSettings({
      enabled,
      family: familyRaw as "ipv6" | "ipv4" | "both"
    });

    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "Upstream DNS resolution settings saved and applied successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true,
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}`
      };
    }
  } catch (error) {
    console.error("Failed to save upstream DNS resolution settings:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to save upstream DNS resolution settings"
    };
  }
}

export async function updateInstanceModeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = String(formData.get("mode") ?? "").trim() as "standalone" | "master" | "slave";
    if (mode !== "standalone" && mode !== "master" && mode !== "slave") {
      return { success: false, message: "Invalid instance mode" };
    }
    await setInstanceMode(mode);
    revalidatePath("/settings");
    return { success: true, message: `Instance mode set to ${mode}` };
  } catch (error) {
    console.error("Failed to update instance mode:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to update instance mode" };
  }
}

export async function updateSlaveMasterTokenAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const clearToken = formData.get("clearToken") === "on";
    const rawToken = formData.get("masterToken") ? String(formData.get("masterToken")).trim() : "";
    const current = await getSlaveMasterToken();

    // If clearing, allow empty token
    if (clearToken) {
      await setSlaveMasterToken("");
      revalidatePath("/settings");
      return { success: true, message: "Master sync token removed" };
    }

    // If a new token is provided, validate it
    if (rawToken) {
      const validation = validateSyncToken(rawToken);
      if (!validation.valid) {
        return { success: false, message: validation.error };
      }
      await setSlaveMasterToken(rawToken);
      revalidatePath("/settings");
      return { success: true, message: "Master sync token updated" };
    }

    // No change - keep existing token
    if (!current) {
      return { success: false, message: "No token provided. Please enter a sync token." };
    }
    return { success: true, message: "Master sync token unchanged" };
  } catch (error) {
    console.error("Failed to update master token:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to update master token" };
  }
}

export async function createSlaveInstanceAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    if (mode !== "master") {
      return { success: false, message: "Instance mode must be set to master to add slaves" };
    }
    const name = String(formData.get("name") ?? "").trim();
    const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
    const apiToken = String(formData.get("apiToken") ?? "").trim();
    if (!name || !baseUrl || !apiToken) {
      return { success: false, message: "Name, base URL, and API token are required" };
    }

    // Validate token complexity
    const validation = validateSyncToken(apiToken);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    await createInstance({ name, baseUrl, apiToken, enabled: true });
    revalidatePath("/settings");
    return { success: true, message: "Slave instance added" };
  } catch (error) {
    console.error("Failed to create slave instance:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to create slave instance" };
  }
}

export async function deleteSlaveInstanceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const mode = await getInstanceMode();
  if (mode !== "master") {
    return;
  }
  const id = Number(formData.get("instanceId"));
  if (Number.isNaN(id)) {
    return;
  }
  await deleteInstance(id);
  revalidatePath("/settings");
}

export async function toggleSlaveInstanceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const mode = await getInstanceMode();
  if (mode !== "master") {
    return;
  }
  const id = Number(formData.get("instanceId"));
  const enabled = formData.get("enabled") === "on";
  if (Number.isNaN(id)) {
    return;
  }
  await updateInstance(id, { enabled });
  revalidatePath("/settings");
}

function parseRedirectUrl(raw: FormDataEntryValue | null): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return trimmed;
  } catch {
    return "";
  }
}

function parseGeoBlockCheckbox(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function parseGeoBlockStringList(key: string, formData: FormData): string[] {
  const val = formData.get(key);
  if (!val || typeof val !== "string") return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseGeoBlockNumberList(key: string, formData: FormData): number[] {
  return parseGeoBlockStringList(key, formData)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
}

function parseGeoBlockResponseHeaders(formData: FormData): Record<string, string> {
  const keys = formData.getAll("geoblockResponseHeadersKeys[]") as string[];
  const values = formData.getAll("geoblockResponseHeadersValues[]") as string[];
  const headers: Record<string, string> = {};
  keys.forEach((key, i) => {
    const trimmed = key.trim();
    if (trimmed && /^[a-zA-Z0-9\-_]+$/.test(trimmed)) {
      headers[trimmed] = (values[i] ?? "").trim();
    }
  });
  return headers;
}

export async function updateGeoBlockSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const enabled = parseGeoBlockCheckbox(formData.get("geoblockEnabled"));

    const statusRaw = formData.get("geoblockResponseStatus");
    const statusNum = statusRaw && typeof statusRaw === "string" && statusRaw.trim() !== ""
      ? Number(statusRaw.trim())
      : NaN;
    const responseStatus = Number.isFinite(statusNum) && statusNum >= 100 && statusNum <= 599 ? statusNum : 403;

    const responseBodyRaw = formData.get("geoblockResponseBody");
    const responseBody = responseBodyRaw && typeof responseBodyRaw === "string" && responseBodyRaw.trim().length > 0
      ? responseBodyRaw.trim()
      : "Forbidden";

    const redirectUrlRaw = formData.get("geoblockRedirectUrl");
    const redirectUrl = parseRedirectUrl(redirectUrlRaw);

    const config: GeoBlockSettings = {
      enabled,
      block_countries: parseGeoBlockStringList("geoblockBlockCountries", formData),
      block_continents: parseGeoBlockStringList("geoblockBlockContinents", formData),
      block_asns: parseGeoBlockNumberList("geoblockBlockAsns", formData),
      block_cidrs: parseGeoBlockStringList("geoblockBlockCidrs", formData),
      block_ips: parseGeoBlockStringList("geoblockBlockIps", formData),
      allow_countries: parseGeoBlockStringList("geoblockAllowCountries", formData),
      allow_continents: parseGeoBlockStringList("geoblockAllowContinents", formData),
      allow_asns: parseGeoBlockNumberList("geoblockAllowAsns", formData),
      allow_cidrs: parseGeoBlockStringList("geoblockAllowCidrs", formData),
      allow_ips: parseGeoBlockStringList("geoblockAllowIps", formData),
      trusted_proxies: parseGeoBlockStringList("geoblockTrustedProxies", formData),
      fail_closed: parseGeoBlockCheckbox(formData.get("geoblockFailClosed")),
      response_status: responseStatus,
      response_body: responseBody,
      response_headers: parseGeoBlockResponseHeaders(formData),
      redirect_url: redirectUrl
    };

    await saveGeoBlockSettings(config);

    try {
      await applyCaddyConfig();
      revalidatePath("/settings");
      return { success: true, message: "Geoblocking settings saved and applied successfully" };
    } catch (error) {
      console.error("Failed to apply Caddy config:", error);
      revalidatePath("/settings");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await syncInstances();
      return {
        success: true,
        message: `Settings saved, but could not apply to Caddy: ${errorMsg}`
      };
    }
  } catch (error) {
    console.error("Failed to save geoblocking settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save geoblocking settings" };
  }
}

export async function syncSlaveInstancesAction(_prevState: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  void _prevState;
  void _formData;
  try {
    await requireAdmin();
    const mode = await getInstanceMode();
    if (mode !== "master") {
      return { success: false, message: "Instance mode must be set to master to sync slaves" };
    }
    const result = await syncInstances();
    revalidatePath("/settings");

    const parts: string[] = [];
    if (result.success > 0) parts.push(`${result.success} succeeded`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    if (result.skippedHttp > 0) parts.push(`${result.skippedHttp} skipped (HTTP blocked)`);

    if (result.skippedHttp > 0) {
      return {
        success: result.success > 0,
        message: `Sync: ${parts.join(", ")}. Set INSTANCE_SYNC_ALLOW_HTTP=true to allow insecure HTTP sync.`
      };
    }
    if (result.failed > 0) {
      return { success: true, message: `Sync completed with ${result.failed} failures (${result.success}/${result.total} succeeded)` };
    }
    return { success: true, message: `Sync completed (${result.success}/${result.total} succeeded)` };
  } catch (error) {
    console.error("Failed to sync slave instances:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to sync slave instances" };
  }
}

export async function lookupWafRuleMessageAction(ruleId: number): Promise<{ message: string | null }> {
  await requireAdmin();
  const map = await getWafRuleMessages([ruleId]);
  return { message: map[ruleId] ?? null };
}

export async function removeWafRuleGloballyAction(ruleId: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await getWafSettings();
    if (!current) return { success: false, message: "WAF settings not found." };
    const ids = (current.excluded_rule_ids ?? []).filter((id) => id !== ruleId);
    await saveWafSettings({ ...current, excluded_rule_ids: ids });
    try { await applyCaddyConfig(); } catch { /* non-fatal */ }
    revalidatePath("/settings");
    revalidatePath("/waf");
    return { success: true, message: `Rule ${ruleId} removed from exclusions.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed to remove WAF rule" };
  }
}

export async function suppressWafRuleGloballyAction(ruleId: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    const current = await getWafSettings();
    const base = current ?? { enabled: false, mode: "Off" as const, load_owasp_crs: true, custom_directives: "", excluded_rule_ids: [] };
    const ids = [...new Set([...(base.excluded_rule_ids ?? []), ruleId])];
    await saveWafSettings({ ...base, excluded_rule_ids: ids });
    try {
      await applyCaddyConfig();
    } catch {
      revalidatePath("/settings");
      return { success: true, message: `Rule ${ruleId} added to exclusions. Warning: could not reload Caddy.` };
    }
    revalidatePath("/settings");
    revalidatePath("/waf");
    return { success: true, message: `Rule ${ruleId} suppressed globally.` };
  } catch (error) {
    console.error("Failed to suppress WAF rule:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to suppress WAF rule" };
  }
}

function redactProviderSecrets<T extends { clientId: string; clientSecret: string }>(provider: T): T {
  const clientId = provider.clientId;
  return {
    ...provider,
    clientId: clientId.length > 4 ? "••••" + clientId.slice(-4) : "••••",
    clientSecret: "••••••••",
  };
}

export async function getOAuthProvidersAction() {
  await requireAdmin();
  const { listOAuthProviders } = await import("@/src/lib/models/oauth-providers");
  const providers = await listOAuthProviders();
  return providers.map(redactProviderSecrets);
}

export async function createOAuthProviderAction(data: {
  name: string;
  type: string;
  clientId: string;
  clientSecret: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  scopes?: string;
  autoLink?: boolean;
}) {
  const session = await requireAdmin();
  const { createOAuthProvider } = await import("@/src/lib/models/oauth-providers");
  const { invalidateProviderCache } = await import("@/src/lib/auth-server");
  const provider = await createOAuthProvider({ ...data, source: "ui" });
  invalidateProviderCache();
  const { createAuditEvent } = await import("@/src/lib/models/audit");
  await createAuditEvent({
    userId: Number(session.user.id),
    action: "oauth_provider_created",
    entityType: "oauth_provider",
    entityId: null,
    summary: `OAuth provider "${data.name}" created`,
    data: JSON.stringify({ providerId: provider.id }),
  });
  revalidatePath("/settings");
  return redactProviderSecrets(provider);
}

export async function updateOAuthProviderAction(
  id: string,
  data: Partial<{
    name: string;
    type: string;
    clientId: string;
    clientSecret: string;
    issuer: string | null;
    authorizationUrl: string | null;
    tokenUrl: string | null;
    userinfoUrl: string | null;
    scopes: string;
    autoLink: boolean;
    enabled: boolean;
  }>
) {
  const session = await requireAdmin();
  const { updateOAuthProvider } = await import("@/src/lib/models/oauth-providers");
  const { invalidateProviderCache } = await import("@/src/lib/auth-server");
  const updated = await updateOAuthProvider(id, data);
  invalidateProviderCache();
  const { createAuditEvent } = await import("@/src/lib/models/audit");
  await createAuditEvent({
    userId: Number(session.user.id),
    action: "oauth_provider_updated",
    entityType: "oauth_provider",
    entityId: null,
    summary: `Updated OAuth provider "${id}"`,
    data: JSON.stringify({ providerId: id, fields: Object.keys(data) }),
  });
  revalidatePath("/settings");
  return updated ? redactProviderSecrets(updated) : null;
}

export async function deleteOAuthProviderAction(id: string) {
  const session = await requireAdmin();
  const { getOAuthProvider, deleteOAuthProvider } = await import("@/src/lib/models/oauth-providers");
  const { invalidateProviderCache } = await import("@/src/lib/auth-server");
  const existing = await getOAuthProvider(id);
  await deleteOAuthProvider(id);
  invalidateProviderCache();
  const { createAuditEvent } = await import("@/src/lib/models/audit");
  await createAuditEvent({
    userId: Number(session.user.id),
    action: "oauth_provider_deleted",
    entityType: "oauth_provider",
    entityId: null,
    summary: `Deleted OAuth provider "${existing?.name ?? id}"`,
    data: JSON.stringify({ providerId: id }),
  });
  revalidatePath("/settings");
}

export async function suppressWafRuleForHostAction(ruleId: number, hostname: string): Promise<ActionResult> {
  try {
    const session = await requireAdmin();
    const userId = Number(session.user.id);
    const hosts = await listProxyHosts();
    const bareHostname = hostname.replace(/:\d+$/, "");
    const host = hosts.find((h) => h.domains.includes(bareHostname));
    if (!host) {
      return { success: false, message: `No proxy host found for ${hostname}.` };
    }
    const existingWaf = host.waf ?? { enabled: true, waf_mode: 'merge' as const };
    const ids = [...new Set([...(existingWaf.excluded_rule_ids ?? []), ruleId])];
    await updateProxyHost(host.id, { waf: { ...existingWaf, enabled: true, waf_mode: existingWaf.waf_mode ?? 'merge', excluded_rule_ids: ids } }, userId);
    revalidatePath("/proxy-hosts");
    revalidatePath("/waf");
    return { success: true, message: `Rule ${ruleId} suppressed for ${hostname}.` };
  } catch (error) {
    console.error("Failed to suppress WAF rule for host:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to suppress WAF rule" };
  }
}

export async function updateWafSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const enabled = formData.get("wafEnabled") === "on";
    const mode: WafSettings["mode"] = enabled ? "On" : "Off";
    const loadOwasp = formData.get("wafLoadOwaspCrs") === "on";
    const customDirectives = typeof formData.get("wafCustomDirectives") === "string"
      ? (formData.get("wafCustomDirectives") as string).trim()
      : "";
    const rawExcl = formData.get("wafExcludedRuleIds");
    let excluded_rule_ids: number[];
    if (rawExcl !== null) {
      excluded_rule_ids = (JSON.parse(rawExcl as string) as unknown[])
        .filter((x): x is number => Number.isInteger(x) && (x as number) > 0);
    } else {
      const existing = await getWafSettings();
      excluded_rule_ids = existing?.excluded_rule_ids ?? [];
    }

    const config: WafSettings = { enabled, mode, load_owasp_crs: loadOwasp, custom_directives: customDirectives, excluded_rule_ids };
    await saveWafSettings(config);

    try {
      await applyCaddyConfig();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: true, message: `Settings saved, but could not apply to Caddy: ${errorMsg}` };
    }

    revalidatePath("/settings");
    revalidatePath("/waf");
    return { success: true, message: "WAF settings saved." };
  } catch (error) {
    console.error("Failed to save WAF settings:", error);
    return { success: false, message: error instanceof Error ? error.message : "Failed to save WAF settings" };
  }
}
