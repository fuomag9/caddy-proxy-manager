"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { applyCaddyConfig } from "@/src/lib/caddy";
import {
  getCloudflareSettings,
  getLoggingSettings,
  saveAuthentikSettings,
  saveCloudflareSettings,
  saveGeneralSettings,
  saveLoggingSettings,
  saveMetricsSettings
} from "@/src/lib/settings";

type ActionResult = {
  success: boolean;
  message?: string;
};

export async function updateGeneralSettingsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    await saveGeneralSettings({
      primaryDomain: String(formData.get("primaryDomain") ?? ""),
      acmeEmail: formData.get("acmeEmail") ? String(formData.get("acmeEmail")) : undefined
    });
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
    const rawToken = formData.get("apiToken") ? String(formData.get("apiToken")).trim() : "";
    const clearToken = formData.get("clearToken") === "on";
    const current = await getCloudflareSettings();

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
    const enabled = formData.get("enabled") === "on";
    const lokiUrl = formData.get("lokiUrl") ? String(formData.get("lokiUrl")).trim() : undefined;
    const lokiUsername = formData.get("lokiUsername") ? String(formData.get("lokiUsername")).trim() : undefined;
    const rawPassword = formData.get("lokiPassword") ? String(formData.get("lokiPassword")).trim() : "";
    const clearPassword = formData.get("clearPassword") === "on";
    const labelsStr = formData.get("labels") ? String(formData.get("labels")).trim() : "";

    // Get current settings to preserve existing password if needed
    const current = await getLoggingSettings();

    // Validate Loki URL if logging is enabled
    if (enabled && !lokiUrl) {
      return { success: false, message: "Loki URL is required when logging is enabled" };
    }

    if (enabled && lokiUrl) {
      try {
        new URL(lokiUrl);
      } catch {
        return { success: false, message: "Invalid Loki URL format. Must be a valid HTTP/HTTPS URL." };
      }
    }

    // Parse labels JSON if provided
    let labels: Record<string, string> | undefined;
    if (labelsStr && labelsStr.length > 0) {
      try {
        labels = JSON.parse(labelsStr);
        if (typeof labels !== "object" || Array.isArray(labels)) {
          return { success: false, message: "Labels must be a JSON object" };
        }
      } catch {
        return { success: false, message: "Invalid labels JSON format" };
      }
    }

    // Handle password: clear if checkbox is checked, update if new password provided, otherwise keep existing
    const lokiPassword = clearPassword ? "" : rawPassword || current?.lokiPassword || "";

    await saveLoggingSettings({
      enabled,
      lokiUrl,
      lokiUsername: lokiUsername && lokiUsername.length > 0 ? lokiUsername : undefined,
      lokiPassword: lokiPassword && lokiPassword.length > 0 ? lokiPassword : undefined,
      labels
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
