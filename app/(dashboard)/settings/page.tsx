import SettingsClient from "./SettingsClient";
import { getGeneralSettings, getAcmeSettings, getAuthentikSettings, getForwardAuthSettings, getMetricsSettings, getLoggingSettings, getDnsSettings, getDnsProviderSettings, getSetting, getUpstreamDnsResolutionSettings, getGeoBlockSettings, getErrorPagesSettings, getTrustedProxiesSettings, getDefaultResponseSettings } from "@/src/lib/settings";
import { getInstanceMode, getSlaveLastSync, getSlaveMasterToken, isInstanceModeFromEnv, isSyncTokenFromEnv, getEnvSlaveInstances } from "@/src/lib/instance-sync";
import { toEnvSlaveInstanceView } from "@/src/lib/instance-sync-view";
import { listInstances, listSyncKeyPinsWithSlaves, withSyncKeyPins } from "@/src/lib/models/instances";
import { getSyncPublicKey } from "@/src/lib/sync-crypto";
import { listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { DNS_PROVIDERS } from "@/src/lib/dns-providers";
import { config } from "@/src/lib/config";
import { requireAdmin } from "@/src/lib/auth";
import { redactDnsProviderSettingsForApi } from "@/src/lib/dns-providers";

export default async function SettingsPage() {
  await requireAdmin();

  // Check if configuration is from environment variables
  const modeFromEnv = isInstanceModeFromEnv();
  const tokenFromEnv = isSyncTokenFromEnv();

  const [general, acme, dnsProvider, authentik, forwardAuth, metrics, logging, dns, upstreamDnsResolution, instanceMode, globalGeoBlock, globalErrorPages, trustedProxies, defaultResponse, oauthProviders] = await Promise.all([
    getGeneralSettings(),
    getAcmeSettings(),
    getDnsProviderSettings(),
    getAuthentikSettings(),
    getForwardAuthSettings(),
    getMetricsSettings(),
    getLoggingSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getInstanceMode(),
    getGeoBlockSettings(),
    getErrorPagesSettings(),
    getTrustedProxiesSettings(),
    getDefaultResponseSettings(),
    listOAuthProviders(),
  ]);

  const [overrideGeneral, overrideAcme, overrideDnsProvider, overrideAuthentik, overrideForwardAuth, overrideMetrics, overrideLogging, overrideDns, overrideUpstreamDnsResolution, overrideTrustedProxies, overrideDefaultResponse] =
    instanceMode === "slave"
      ? await Promise.all([
          getSetting("general"),
          getSetting("acme"),
          getSetting("dns_provider"),
          getSetting("authentik"),
          getSetting("forward_auth"),
          getSetting("metrics"),
          getSetting("logging"),
          getSetting("dns"),
          getSetting("upstream_dns_resolution"),
          getSetting("trusted_proxies"),
          getSetting("default_response")
        ])
      : [null, null, null, null, null, null, null, null, null, null, null];

  const [slaveToken, slaveLastSync] = instanceMode === "slave"
    ? await Promise.all([getSlaveMasterToken(), getSlaveLastSync()])
    : [null, null];

  const instances = instanceMode === "master" ? await listInstances() : [];
  const envInstances = instanceMode === "master"
    ? await withSyncKeyPins(getEnvSlaveInstances().map(toEnvSlaveInstanceView))
    : [];
  // Pins of URLs no slave syncs to any more (for example an INSTANCE_SLAVES
  // entry that was removed); a slave added at such a URL inherits the pin.
  const orphanSyncKeyPins = instanceMode === "master"
    ? (await listSyncKeyPinsWithSlaves())
      .filter((pin) => pin.slaves.length === 0)
      .map(({ url, keyId, publicKey, pinnedAt, source }) => ({ url, keyId, publicKey, pinnedAt, source }))
    : [];
  // Set exactly in slave mode.
  const ownSyncKey = instanceMode === "slave" ? getSyncPublicKey() : null;

  return (
    <SettingsClient
      general={general}
      acme={acme}
      dnsProvider={dnsProvider ? redactDnsProviderSettingsForApi(dnsProvider) : null}
      dnsProviderDefinitions={DNS_PROVIDERS}
      authentik={authentik}
      forwardAuth={forwardAuth}
      metrics={metrics}
      logging={logging}
      dns={dns}
      upstreamDnsResolution={upstreamDnsResolution}
      trustedProxies={trustedProxies}
      defaultResponse={defaultResponse}
      globalGeoBlock={globalGeoBlock}
      globalErrorPages={globalErrorPages}
      oauthProviders={oauthProviders}
      baseUrl={config.baseUrl}
      instanceSync={{
        mode: instanceMode,
        modeFromEnv,
        tokenFromEnv,
        overrides: {
          general: overrideGeneral !== null,
          acme: overrideAcme !== null,
          dnsProvider: overrideDnsProvider !== null,
          authentik: overrideAuthentik !== null,
          forwardAuth: overrideForwardAuth !== null,
          metrics: overrideMetrics !== null,
          logging: overrideLogging !== null,
          dns: overrideDns !== null,
          upstreamDnsResolution: overrideUpstreamDnsResolution !== null,
          trustedProxies: overrideTrustedProxies !== null,
          defaultResponse: overrideDefaultResponse !== null
        },
        slave: ownSyncKey ? {
          hasToken: Boolean(slaveToken),
          lastSyncAt: slaveLastSync?.at ?? null,
          lastSyncError: slaveLastSync?.error ?? null,
          syncKeyId: ownSyncKey.keyId,
          syncPublicKey: ownSyncKey.publicKey.toString("base64")
        } : null,
        master: instanceMode === "master" ? { instances, envInstances, orphanSyncKeyPins } : null
      }}
    />
  );
}
