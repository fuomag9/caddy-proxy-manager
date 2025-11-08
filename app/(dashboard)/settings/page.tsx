import SettingsClient from "./SettingsClient";
import { getCloudflareSettings, getGeneralSettings, getAuthentikSettings } from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();

  const [general, cloudflare, authentik] = await Promise.all([
    getGeneralSettings(),
    getCloudflareSettings(),
    getAuthentikSettings()
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
    />
  );
}
