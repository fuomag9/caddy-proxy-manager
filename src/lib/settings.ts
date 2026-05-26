import db, { nowIso } from "./db";
import { settings } from "./db/schema";
import { eq } from "drizzle-orm";
import { sanitizeErrorPageRules, type ErrorPageRule } from "./models/proxy-hosts";

export type SettingValue<T> = T | null;

export type CloudflareSettings = {
  apiToken: string;
  zoneId?: string;
  accountId?: string;
};

export type GeneralSettings = {
  primaryDomain: string;
  acmeEmail?: string;
};

export type AuthentikSettings = {
  outpostDomain: string;
  outpostUpstream: string;
  authEndpoint?: string;
};

export type MetricsSettings = {
  enabled: boolean;
  port?: number; // Port to expose metrics on (default: 9090, separate from admin API)
};

export type LoggingSettings = {
  enabled: boolean;
  format?: "json" | "console"; // Log format (default: json)
};

export type DnsSettings = {
  enabled: boolean;
  resolvers: string[]; // Primary DNS resolvers (e.g., "1.1.1.1", "8.8.8.8")
  fallbacks?: string[]; // Fallback DNS resolvers if primary fails
  timeout?: string; // DNS query timeout (e.g., "5s")
};

export type DnsProviderSettings = {
  /** Configured providers: keyed by provider name, value is credential map */
  providers: Record<string, Record<string, string>>;
  /** Name of the default provider (null = no DNS-01 challenges) */
  default: string | null;
};

export type UpstreamDnsAddressFamily = "ipv6" | "ipv4" | "both";

export type UpstreamDnsResolutionSettings = {
  enabled: boolean;
  family: UpstreamDnsAddressFamily;
};

export type GeoBlockSettings = {
  enabled: boolean;

  // Block rules
  block_countries: string[];    // ISO 3166-1 alpha-2, e.g. ["CN", "RU"]
  block_continents: string[];   // AF, AN, AS, EU, NA, OC, SA
  block_asns: number[];
  block_cidrs: string[];
  block_ips: string[];

  // Allow rules (win over block rules)
  allow_countries: string[];
  allow_continents: string[];
  allow_asns: number[];
  allow_cidrs: string[];
  allow_ips: string[];

  // Trusted proxies for X-Forwarded-For parsing
  trusted_proxies: string[];
  // When true, block requests where the real client IP cannot be determined
  // (e.g. connection from trusted proxy but no usable XFF entry). Default: false (fail-open)
  fail_closed: boolean;

  // Block response customization
  response_status: number;        // default 403
  response_body: string;          // default "Forbidden"
  response_headers: Record<string, string>;
  redirect_url: string;           // if set, 302 redirect instead of status/body
};

type InstanceMode = "standalone" | "master" | "slave";

const INSTANCE_MODE_KEY = "instance_mode";
const SYNCED_PREFIX = "synced:";

export async function getSetting<T>(key: string): Promise<SettingValue<T>> {
  const setting = await db.query.settings.findFirst({
    where: (table, { eq }) => eq(table.key, key)
  });

  if (!setting) {
    return null;
  }

  try {
    return JSON.parse(setting.value) as T;
  } catch (error) {
    console.warn(`Failed to parse setting ${key}`, error);
    return null;
  }
}

async function getInstanceModeForSettings(): Promise<InstanceMode> {
  const stored = await getSetting<string>(INSTANCE_MODE_KEY);
  if (stored === "master" || stored === "slave" || stored === "standalone") {
    return stored;
  }
  return "standalone";
}

async function getSyncedSetting<T>(key: string): Promise<SettingValue<T>> {
  return await getSetting<T>(`${SYNCED_PREFIX}${key}`);
}

export async function getEffectiveSetting<T>(key: string): Promise<SettingValue<T>> {
  const mode = await getInstanceModeForSettings();
  if (mode !== "slave") {
    return await getSetting<T>(key);
  }

  const override = await getSetting<T>(key);
  if (override !== null) {
    return override;
  }

  return await getSyncedSetting<T>(key);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const payload = JSON.stringify(value);
  const now = nowIso();

  await db
    .insert(settings)
    .values({
      key,
      value: payload,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: payload,
        updatedAt: now
      }
    });
}

export async function clearSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function getCloudflareSettings(): Promise<CloudflareSettings | null> {
  return await getEffectiveSetting<CloudflareSettings>("cloudflare");
}

export async function saveCloudflareSettings(settings: CloudflareSettings): Promise<void> {
  await setSetting("cloudflare", settings);
}

export async function getGeneralSettings(): Promise<GeneralSettings | null> {
  return await getEffectiveSetting<GeneralSettings>("general");
}

export async function saveGeneralSettings(settings: GeneralSettings): Promise<void> {
  await setSetting("general", settings);
}

export async function getAuthentikSettings(): Promise<AuthentikSettings | null> {
  return await getEffectiveSetting<AuthentikSettings>("authentik");
}

export async function saveAuthentikSettings(settings: AuthentikSettings): Promise<void> {
  await setSetting("authentik", settings);
}

export async function getMetricsSettings(): Promise<MetricsSettings | null> {
  return await getEffectiveSetting<MetricsSettings>("metrics");
}

export async function saveMetricsSettings(settings: MetricsSettings): Promise<void> {
  await setSetting("metrics", settings);
}

export async function getLoggingSettings(): Promise<LoggingSettings | null> {
  return await getEffectiveSetting<LoggingSettings>("logging");
}

export async function saveLoggingSettings(settings: LoggingSettings): Promise<void> {
  await setSetting("logging", settings);
}

export async function getDnsSettings(): Promise<DnsSettings | null> {
  return await getEffectiveSetting<DnsSettings>("dns");
}

export async function saveDnsSettings(settings: DnsSettings): Promise<void> {
  await setSetting("dns", settings);
}

export async function getDnsProviderSettings(): Promise<DnsProviderSettings | null> {
  const raw = await getEffectiveSetting<Record<string, unknown>>("dns_provider");
  if (!raw) return null;

  // Normalize old single-provider format { provider, credentials }
  // to new multi-provider format { providers, default }
  if ("provider" in raw && "credentials" in raw && !("providers" in raw)) {
    const name = raw.provider as string;
    const creds = raw.credentials as Record<string, string>;
    return { providers: { [name]: creds }, default: name };
  }

  return raw as unknown as DnsProviderSettings;
}

export async function saveDnsProviderSettings(settings: DnsProviderSettings): Promise<void> {
  await setSetting("dns_provider", settings);
}

export async function getUpstreamDnsResolutionSettings(): Promise<UpstreamDnsResolutionSettings | null> {
  return await getEffectiveSetting<UpstreamDnsResolutionSettings>("upstream_dns_resolution");
}

export async function saveUpstreamDnsResolutionSettings(settings: UpstreamDnsResolutionSettings): Promise<void> {
  await setSetting("upstream_dns_resolution", settings);
}

export async function getGeoBlockSettings(): Promise<GeoBlockSettings | null> {
  return await getEffectiveSetting<GeoBlockSettings>("geoblock");
}

export async function saveGeoBlockSettings(settings: GeoBlockSettings): Promise<void> {
  await setSetting("geoblock", settings);
}

export type WafSettings = {
  enabled: boolean;
  mode: 'Off' | 'On';
  load_owasp_crs: boolean;
  custom_directives: string;
  excluded_rule_ids?: number[];
};

export async function getWafSettings(): Promise<WafSettings | null> {
  return await getEffectiveSetting<WafSettings>("waf");
}

export async function saveWafSettings(s: WafSettings): Promise<void> {
  await setSetting("waf", s);
}

// Global error pages, applied as fallback error routes across every proxy host.
// Per-host error pages take precedence over these.
export type ErrorPagesSettings = {
  rules: ErrorPageRule[];
};

export async function getErrorPagesSettings(): Promise<ErrorPagesSettings | null> {
  return await getEffectiveSetting<ErrorPagesSettings>("error_pages");
}

export async function saveErrorPagesSettings(s: ErrorPagesSettings): Promise<void> {
  await setSetting("error_pages", { rules: sanitizeErrorPageRules(s?.rules) });
}
