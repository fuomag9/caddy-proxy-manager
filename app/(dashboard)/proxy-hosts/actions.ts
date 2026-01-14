"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { actionError, actionSuccess, INITIAL_ACTION_STATE, type ActionState } from "@/src/lib/actions";
import { createProxyHost, deleteProxyHost, updateProxyHost, type ProxyHostAuthentikInput } from "@/src/lib/models/proxy-hosts";
import { getCertificate } from "@/src/lib/models/certificates";
import { getCloudflareSettings } from "@/src/lib/settings";

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
        authentik: parseAuthentikConfig(formData)
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
        authentik: parseAuthentikConfig(formData)
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
