"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { getInstanceMode, getSlaveMasterToken, setInstanceMode, setSlaveMasterToken, syncInstances } from "@/src/lib/instance-sync";
import { createInstance, deleteInstance, updateInstance } from "@/src/lib/models/instances";
import { clearSetting, getSetting, saveCloudflareSettings, saveGeneralSettings, saveAuthentikSettings, saveMetricsSettings, saveLoggingSettings, saveDnsSettings, saveUpstreamDnsResolutionSettings, saveGeoBlockSettings } from "@/src/lib/settings";
import type { CloudflareSettings, GeoBlockSettings } from "@/src/lib/settings";

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
  const keys = formData.getAll("geoblock_response_headers_keys[]") as string[];
  const values = formData.getAll("geoblock_response_headers_values[]") as string[];
  const headers: Record<string, string> = {};
  keys.forEach((key, i) => {
    const trimmed = key.trim();
    if (trimmed) headers[trimmed] = (values[i] ?? "").trim();
  });
  return headers;
}

export async function updateGeoBlockSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const enabled = parseGeoBlockCheckbox(formData.get("geoblock_enabled"));

    const statusRaw = formData.get("geoblock_response_status");
    const statusNum = statusRaw && typeof statusRaw === "string" && statusRaw.trim() !== ""
      ? Number(statusRaw.trim())
      : NaN;
    const responseStatus = Number.isFinite(statusNum) ? statusNum : 403;

    const responseBodyRaw = formData.get("geoblock_response_body");
    const responseBody = responseBodyRaw && typeof responseBodyRaw === "string" && responseBodyRaw.trim().length > 0
      ? responseBodyRaw.trim()
      : "Forbidden";

    const redirectUrlRaw = formData.get("geoblock_redirect_url");
    const redirectUrl = redirectUrlRaw && typeof redirectUrlRaw === "string" ? redirectUrlRaw.trim() : "";

    const config: GeoBlockSettings = {
      enabled,
      block_countries: parseGeoBlockStringList("geoblock_block_countries", formData),
      block_continents: parseGeoBlockStringList("geoblock_block_continents", formData),
      block_asns: parseGeoBlockNumberList("geoblock_block_asns", formData),
      block_cidrs: parseGeoBlockStringList("geoblock_block_cidrs", formData),
      block_ips: parseGeoBlockStringList("geoblock_block_ips", formData),
      allow_countries: parseGeoBlockStringList("geoblock_allow_countries", formData),
      allow_continents: parseGeoBlockStringList("geoblock_allow_continents", formData),
      allow_asns: parseGeoBlockNumberList("geoblock_allow_asns", formData),
      allow_cidrs: parseGeoBlockStringList("geoblock_allow_cidrs", formData),
      allow_ips: parseGeoBlockStringList("geoblock_allow_ips", formData),
      trusted_proxies: parseGeoBlockStringList("geoblock_trusted_proxies", formData),
      fail_closed: parseGeoBlockCheckbox(formData.get("geoblock_fail_closed")),
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
