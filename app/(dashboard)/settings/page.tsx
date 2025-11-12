import SettingsClient from "./SettingsClient";
import {
  getAuthentikSettings,
  getCloudflareSettings,
  getGeneralSettings,
  getLoggingSettings,
  getMetricsSettings
} from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();

  const [general, cloudflare, authentik, metrics, logging] = await Promise.all([
    getGeneralSettings(),
    getCloudflareSettings(),
    getAuthentikSettings(),
    getMetricsSettings(),
    getLoggingSettings()
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
      logging={logging ? {
        enabled: logging.enabled,
        lokiUrl: logging.lokiUrl,
        lokiUsername: logging.lokiUsername,
        hasPassword: Boolean(logging.lokiPassword),
        labels: logging.labels
      } : null}
    />
  );
}
