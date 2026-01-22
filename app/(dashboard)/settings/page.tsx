import SettingsClient from "./SettingsClient";
import { getCloudflareSettings, getGeneralSettings, getAuthentikSettings, getMetricsSettings, getLoggingSettings, getDnsSettings } from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();

  const [general, cloudflare, authentik, metrics, logging, dns] = await Promise.all([
    getGeneralSettings(),
    getCloudflareSettings(),
    getAuthentikSettings(),
    getMetricsSettings(),
    getLoggingSettings(),
    getDnsSettings()
  ]);

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
    />
  );
}
