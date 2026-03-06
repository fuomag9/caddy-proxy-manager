import SettingsClient from "./SettingsClient";
import { getCloudflareSettings, getGeneralSettings, getAuthentikSettings, getMetricsSettings, getLoggingSettings, getDnsSettings, getSetting, getUpstreamDnsResolutionSettings, getGeoBlockSettings } from "@/src/lib/settings";
import { getInstanceMode, getSlaveLastSync, getSlaveMasterToken, isInstanceModeFromEnv, isSyncTokenFromEnv, getEnvSlaveInstances } from "@/src/lib/instance-sync";
import { listInstances } from "@/src/lib/models/instances";
import { requireAdmin } from "@/src/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();

  // Check if configuration is from environment variables
  const modeFromEnv = isInstanceModeFromEnv();
  const tokenFromEnv = isSyncTokenFromEnv();

  const [general, cloudflare, authentik, metrics, logging, dns, upstreamDnsResolution, instanceMode, globalGeoBlock] = await Promise.all([
    getGeneralSettings(),
    getCloudflareSettings(),
    getAuthentikSettings(),
    getMetricsSettings(),
    getLoggingSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getInstanceMode(),
    getGeoBlockSettings(),
  ]);

  const [overrideGeneral, overrideCloudflare, overrideAuthentik, overrideMetrics, overrideLogging, overrideDns, overrideUpstreamDnsResolution] =
    instanceMode === "slave"
      ? await Promise.all([
          getSetting("general"),
          getSetting("cloudflare"),
          getSetting("authentik"),
          getSetting("metrics"),
          getSetting("logging"),
          getSetting("dns"),
          getSetting("upstream_dns_resolution")
        ])
      : [null, null, null, null, null, null, null];

  const [slaveToken, slaveLastSync] = instanceMode === "slave"
    ? await Promise.all([getSlaveMasterToken(), getSlaveLastSync()])
    : [null, null];

  const instances = instanceMode === "master" ? await listInstances() : [];
  const envInstances = instanceMode === "master" ? getEnvSlaveInstances() : [];

  return (
    <SettingsClient
      general={general}
      cloudflare={{
        hasToken: Boolean(cloudflare?.apiToken),
        zoneId: cloudflare?.zoneId,
        accountId: cloudflare?.accountId
      }}
      authentik={authentik}
      metrics={metrics}
      logging={logging}
      dns={dns}
      upstreamDnsResolution={upstreamDnsResolution}
      globalGeoBlock={globalGeoBlock}
      instanceSync={{
        mode: instanceMode,
        modeFromEnv,
        tokenFromEnv,
        overrides: {
          general: overrideGeneral !== null,
          cloudflare: overrideCloudflare !== null,
          authentik: overrideAuthentik !== null,
          metrics: overrideMetrics !== null,
          logging: overrideLogging !== null,
          dns: overrideDns !== null,
          upstreamDnsResolution: overrideUpstreamDnsResolution !== null
        },
        slave: instanceMode === "slave" ? {
          hasToken: Boolean(slaveToken),
          lastSyncAt: slaveLastSync?.at ?? null,
          lastSyncError: slaveLastSync?.error ?? null
        } : null,
        master: instanceMode === "master" ? { instances, envInstances } : null
      }}
    />
  );
}
