"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  GeneralSettings,
  AuthentikSettings,
  MetricsSettings,
  LoggingSettings,
  DnsSettings,
  UpstreamDnsResolutionSettings,
  GeoBlockSettings,
} from "@/lib/settings";
import { GeoBlockFields } from "@/components/proxy-hosts/GeoBlockFields";
import {
  updateCloudflareSettingsAction,
  updateGeneralSettingsAction,
  updateAuthentikSettingsAction,
  updateMetricsSettingsAction,
  updateLoggingSettingsAction,
  updateDnsSettingsAction,
  updateUpstreamDnsResolutionSettingsAction,
  updateInstanceModeAction,
  updateSlaveMasterTokenAction,
  createSlaveInstanceAction,
  deleteSlaveInstanceAction,
  toggleSlaveInstanceAction,
  syncSlaveInstancesAction,
  updateGeoBlockSettingsAction,
} from "./actions";

// Helper to render a status alert with appropriate color
function StatusAlert({ message, success }: { message: string; success: boolean }) {
  return (
    <Alert variant={success ? "default" : "destructive"}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// Info alert
function InfoAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="border-blue-500/50 text-blue-700 dark:text-blue-400 [&>svg]:text-blue-500">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

// Warning alert
function WarnAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="border-yellow-500/50 text-yellow-700 dark:text-yellow-400 [&>svg]:text-yellow-500">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

type Props = {
  general: GeneralSettings | null;
  cloudflare: {
    hasToken: boolean;
    zoneId?: string;
    accountId?: string;
  };
  authentik: AuthentikSettings | null;
  metrics: MetricsSettings | null;
  logging: LoggingSettings | null;
  dns: DnsSettings | null;
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  instanceSync: {
    mode: "standalone" | "master" | "slave";
    modeFromEnv: boolean;
    tokenFromEnv: boolean;
    overrides: {
      general: boolean;
      cloudflare: boolean;
      authentik: boolean;
      metrics: boolean;
      logging: boolean;
      dns: boolean;
      upstreamDnsResolution: boolean;
    };
    slave: {
      hasToken: boolean;
      lastSyncAt: string | null;
      lastSyncError: string | null;
    } | null;
    master: {
      instances: Array<{
        id: number;
        name: string;
        base_url: string;
        enabled: boolean;
        last_sync_at: string | null;
        last_sync_error: string | null;
      }>;
      envInstances: Array<{
        name: string;
        url: string;
      }>;
    } | null;
  };
};

export default function SettingsClient({
  general,
  cloudflare,
  authentik,
  metrics,
  logging,
  dns,
  upstreamDnsResolution,
  globalGeoBlock,
  instanceSync
}: Props) {
  const [generalState, generalFormAction] = useFormState(updateGeneralSettingsAction, null);
  const [cloudflareState, cloudflareFormAction] = useFormState(updateCloudflareSettingsAction, null);
  const [authentikState, authentikFormAction] = useFormState(updateAuthentikSettingsAction, null);
  const [metricsState, metricsFormAction] = useFormState(updateMetricsSettingsAction, null);
  const [loggingState, loggingFormAction] = useFormState(updateLoggingSettingsAction, null);
  const [dnsState, dnsFormAction] = useFormState(updateDnsSettingsAction, null);
  const [upstreamDnsResolutionState, upstreamDnsResolutionFormAction] = useFormState(
    updateUpstreamDnsResolutionSettingsAction,
    null
  );
  const [instanceModeState, instanceModeFormAction] = useFormState(updateInstanceModeAction, null);
  const [slaveTokenState, slaveTokenFormAction] = useFormState(updateSlaveMasterTokenAction, null);
  const [slaveInstanceState, slaveInstanceFormAction] = useFormState(createSlaveInstanceAction, null);
  const [syncState, syncFormAction] = useFormState(syncSlaveInstancesAction, null);
  const [geoBlockState, geoBlockFormAction] = useFormState(updateGeoBlockSettingsAction, null);

  const isSlave = instanceSync.mode === "slave";
  const isMaster = instanceSync.mode === "master";
  const [generalOverride, setGeneralOverride] = useState(instanceSync.overrides.general);
  const [cloudflareOverride, setCloudflareOverride] = useState(instanceSync.overrides.cloudflare);
  const [authentikOverride, setAuthentikOverride] = useState(instanceSync.overrides.authentik);
  const [metricsOverride, setMetricsOverride] = useState(instanceSync.overrides.metrics);
  const [loggingOverride, setLoggingOverride] = useState(instanceSync.overrides.logging);
  const [dnsOverride, setDnsOverride] = useState(instanceSync.overrides.dns);
  const [upstreamDnsResolutionOverride, setUpstreamDnsResolutionOverride] = useState(
    instanceSync.overrides.upstreamDnsResolution
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure organization-wide defaults and DNS automation.</p>
      </div>

      {/* Instance Sync */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Instance Sync</h2>
          <p className="text-sm text-muted-foreground">
            Choose whether this instance acts independently, pushes configuration to slave nodes, or pulls configuration from a master.
          </p>
          <form action={instanceModeFormAction} className="flex flex-col gap-3">
            {instanceSync.modeFromEnv && (
              <InfoAlert>
                Instance mode is configured via INSTANCE_MODE environment variable and cannot be changed at runtime.
              </InfoAlert>
            )}
            {instanceModeState?.message && (
              <StatusAlert message={instanceModeState.message} success={instanceModeState.success} />
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="instance-mode">Instance mode</Label>
              <Select name="mode" defaultValue={instanceSync.mode} disabled={instanceSync.modeFromEnv}>
                <SelectTrigger id="instance-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone</SelectItem>
                  <SelectItem value="master">Master</SelectItem>
                  <SelectItem value="slave">Slave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={instanceSync.modeFromEnv}>
                Save instance mode
              </Button>
            </div>
          </form>

          {isSlave && (
            <div className="flex flex-col gap-3 mt-2">
              <h3 className="font-semibold">Master Connection</h3>
              <form action={slaveTokenFormAction} className="flex flex-col gap-3">
                {instanceSync.tokenFromEnv && (
                  <InfoAlert>
                    Sync token is configured via INSTANCE_SYNC_TOKEN environment variable and cannot be changed at runtime.
                  </InfoAlert>
                )}
                {slaveTokenState?.message && (
                  <StatusAlert message={slaveTokenState.message} success={slaveTokenState.success} />
                )}
                {instanceSync.slave?.hasToken && !instanceSync.tokenFromEnv && (
                  <InfoAlert>
                    A master sync token is configured. Leave the token field blank to keep it, or select &ldquo;Remove existing token&rdquo; to delete it.
                  </InfoAlert>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="masterToken">Master sync token</Label>
                  <Input
                    id="masterToken"
                    name="masterToken"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Enter new token"
                    disabled={instanceSync.tokenFromEnv}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="clearToken"
                    name="clearToken"
                    disabled={!instanceSync.slave?.hasToken || instanceSync.tokenFromEnv}
                  />
                  <Label htmlFor="clearToken">Remove existing token</Label>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={instanceSync.tokenFromEnv}>
                    Save master token
                  </Button>
                </div>
              </form>
              {instanceSync.slave?.lastSyncError ? (
                <WarnAlert>
                  {instanceSync.slave?.lastSyncAt
                    ? `Last sync: ${instanceSync.slave.lastSyncAt} (${instanceSync.slave.lastSyncError})`
                    : "No sync payload has been received yet."}
                </WarnAlert>
              ) : (
                <InfoAlert>
                  {instanceSync.slave?.lastSyncAt
                    ? `Last sync: ${instanceSync.slave.lastSyncAt}`
                    : "No sync payload has been received yet."}
                </InfoAlert>
              )}
            </div>
          )}

          {isMaster && (
            <div className="flex flex-col gap-3 mt-2">
              <h3 className="font-semibold">Slave Instances</h3>
              <form action={slaveInstanceFormAction} className="flex flex-col gap-3">
                {slaveInstanceState?.message && (
                  <StatusAlert message={slaveInstanceState.message} success={slaveInstanceState.success} />
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inst-name">Instance name</Label>
                  <Input id="inst-name" name="name" placeholder="Edge node EU-1" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inst-base-url">Base URL</Label>
                  <Input id="inst-base-url" name="baseUrl" placeholder="https://slave-1.example.com" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inst-api-token">Slave API token</Label>
                  <Input id="inst-api-token" name="apiToken" type="password" autoComplete="new-password" />
                </div>
                <div className="flex justify-end">
                  <Button type="submit">Add slave instance</Button>
                </div>
              </form>

              <form action={syncFormAction} className="flex flex-col gap-3">
                {syncState?.message && (
                  <StatusAlert message={syncState.message} success={syncState.success} />
                )}
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">Sync now</Button>
                </div>
              </form>

              {instanceSync.master?.instances.length === 0 && instanceSync.master?.envInstances.length === 0 && (
                <InfoAlert>No slave instances configured yet.</InfoAlert>
              )}

              {instanceSync.master?.envInstances && instanceSync.master.envInstances.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground mt-1">
                    Environment-configured instances (via INSTANCE_SLAVES)
                  </p>
                  {instanceSync.master.envInstances.map((instance, index) => (
                    <div
                      key={`env-${index}`}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4 bg-muted/40"
                    >
                      <div>
                        <p className="font-semibold">{instance.name}</p>
                        <p className="text-sm text-muted-foreground">{instance.url}</p>
                        <span className="text-xs text-muted-foreground">Configured via environment variable</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {instanceSync.master?.instances && instanceSync.master.instances.length > 0 && (
                <p className="text-sm text-muted-foreground mt-1">UI-configured instances</p>
              )}
              {instanceSync.master?.instances.map((instance) => (
                <div
                  key={instance.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4"
                >
                  <div>
                    <p className="font-semibold">{instance.name}</p>
                    <p className="text-sm text-muted-foreground">{instance.base_url}</p>
                    <span className="text-xs text-muted-foreground">
                      {instance.last_sync_at ? `Last sync: ${instance.last_sync_at}` : "No sync yet"}
                    </span>
                    {instance.last_sync_error && (
                      <span className="block text-xs text-destructive">{instance.last_sync_error}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <form action={toggleSlaveInstanceAction}>
                      <input type="hidden" name="instanceId" value={instance.id} />
                      <input type="hidden" name="enabled" value={instance.enabled ? "" : "on"} />
                      <Button type="submit" variant="outline" className={instance.enabled ? "text-yellow-600 border-yellow-600/50" : "text-green-600 border-green-600/50"}>
                        {instance.enabled ? "Disable" : "Enable"}
                      </Button>
                    </form>
                    <form action={deleteSlaveInstanceAction}>
                      <input type="hidden" name="instanceId" value={instance.id} />
                      <Button type="submit" variant="outline" className="text-destructive border-destructive/50">
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* General */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">General</h2>
          <form action={generalFormAction} className="flex flex-col gap-3">
            {generalState?.message && (
              <StatusAlert message={generalState.message} success={generalState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="general-override"
                  name="overrideEnabled"
                  checked={generalOverride}
                  onCheckedChange={(v) => setGeneralOverride(!!v)}
                />
                <Label htmlFor="general-override">Override master settings</Label>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="primaryDomain">Primary domain</Label>
              <Input
                id="primaryDomain"
                name="primaryDomain"
                defaultValue={general?.primaryDomain ?? "caddyproxymanager.com"}
                required
                disabled={isSlave && !generalOverride}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acmeEmail">ACME contact email</Label>
              <Input
                id="acmeEmail"
                name="acmeEmail"
                type="email"
                defaultValue={general?.acmeEmail ?? ""}
                disabled={isSlave && !generalOverride}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save general settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Cloudflare DNS */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Cloudflare DNS</h2>
          <p className="text-sm text-muted-foreground">
            Configure a Cloudflare API token with Zone.DNS Edit permissions to enable DNS-01 challenges for wildcard certificates.
          </p>
          {cloudflare.hasToken && (
            <InfoAlert>
              A Cloudflare API token is already configured. Leave the token field blank to keep it, or select &ldquo;Remove existing token&rdquo; to delete it.
            </InfoAlert>
          )}
          <form action={cloudflareFormAction} className="flex flex-col gap-3">
            {cloudflareState?.message && (
              <StatusAlert message={cloudflareState.message} success={cloudflareState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cloudflare-override"
                  name="overrideEnabled"
                  checked={cloudflareOverride}
                  onCheckedChange={(v) => setCloudflareOverride(!!v)}
                />
                <Label htmlFor="cloudflare-override">Override master settings</Label>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-apiToken">API token</Label>
              <Input
                id="cf-apiToken"
                name="apiToken"
                type="password"
                autoComplete="new-password"
                placeholder="Enter new token"
                disabled={isSlave && !cloudflareOverride}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cf-clearToken"
                name="clearToken"
                disabled={!cloudflare.hasToken || (isSlave && !cloudflareOverride)}
              />
              <Label htmlFor="cf-clearToken">Remove existing token</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-zoneId">Zone ID</Label>
              <Input id="cf-zoneId" name="zoneId" defaultValue={cloudflare.zoneId ?? ""} disabled={isSlave && !cloudflareOverride} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-accountId">Account ID</Label>
              <Input id="cf-accountId" name="accountId" defaultValue={cloudflare.accountId ?? ""} disabled={isSlave && !cloudflareOverride} />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save Cloudflare settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* DNS Resolvers */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">DNS Resolvers</h2>
          <p className="text-sm text-muted-foreground">
            Configure custom DNS resolvers for ACME DNS-01 challenges. These resolvers will be used to verify DNS records during certificate issuance.
          </p>
          <form action={dnsFormAction} className="flex flex-col gap-3">
            {dnsState?.message && (
              <StatusAlert message={dnsState.message} success={dnsState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dns-override"
                  name="overrideEnabled"
                  checked={dnsOverride}
                  onCheckedChange={(v) => setDnsOverride(!!v)}
                />
                <Label htmlFor="dns-override">Override master settings</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="dns-enabled"
                name="enabled"
                defaultChecked={dns?.enabled ?? false}
                disabled={isSlave && !dnsOverride}
              />
              <Label htmlFor="dns-enabled">Enable custom DNS resolvers</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-resolvers">Primary DNS Resolvers</Label>
              <textarea
                id="dns-resolvers"
                name="resolvers"
                placeholder={"1.1.1.1\n8.8.8.8"}
                defaultValue={dns?.resolvers?.join("\n") ?? ""}
                rows={2}
                disabled={isSlave && !dnsOverride}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
              <p className="text-xs text-muted-foreground">One resolver per line (e.g., 1.1.1.1, 8.8.8.8). Used for ACME DNS verification.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-fallbacks">Fallback DNS Resolvers (Optional)</Label>
              <textarea
                id="dns-fallbacks"
                name="fallbacks"
                placeholder={"8.8.4.4\n1.0.0.1"}
                defaultValue={dns?.fallbacks?.join("\n") ?? ""}
                rows={2}
                disabled={isSlave && !dnsOverride}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
              <p className="text-xs text-muted-foreground">Fallback resolvers if primary fails. One per line.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-timeout">DNS Query Timeout</Label>
              <Input
                id="dns-timeout"
                name="timeout"
                placeholder="5s"
                defaultValue={dns?.timeout ?? ""}
                disabled={isSlave && !dnsOverride}
              />
              <p className="text-xs text-muted-foreground">Timeout for DNS queries (e.g., 5s, 10s)</p>
            </div>
            <InfoAlert>
              Custom DNS resolvers are useful when your DNS provider has slow propagation or when using split-horizon DNS.
              Common public resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
            </InfoAlert>
            <div className="flex justify-end">
              <Button type="submit">Save DNS settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Upstream DNS Pinning */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Upstream DNS Pinning</h2>
          <p className="text-sm text-muted-foreground">
            Optionally resolve upstream hostnames when applying config and pin reverse proxy upstream dials to IP addresses.
            This can avoid runtime DNS churn and lets you force IPv6, IPv4, or both (IPv6 preferred).
          </p>
          <form action={upstreamDnsResolutionFormAction} className="flex flex-col gap-3">
            {upstreamDnsResolutionState?.message && (
              <StatusAlert message={upstreamDnsResolutionState.message} success={upstreamDnsResolutionState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="udns-override"
                  name="overrideEnabled"
                  checked={upstreamDnsResolutionOverride}
                  onCheckedChange={(v) => setUpstreamDnsResolutionOverride(!!v)}
                />
                <Label htmlFor="udns-override">Override master settings</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="udns-enabled"
                name="enabled"
                defaultChecked={upstreamDnsResolution?.enabled ?? false}
                disabled={isSlave && !upstreamDnsResolutionOverride}
              />
              <Label htmlFor="udns-enabled">Enable upstream DNS pinning during config apply</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="udns-family">Address Family Preference</Label>
              <Select
                name="family"
                defaultValue={upstreamDnsResolution?.family ?? "both"}
                disabled={isSlave && !upstreamDnsResolutionOverride}
              >
                <SelectTrigger id="udns-family">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both (Prefer IPv6)</SelectItem>
                  <SelectItem value="ipv6">IPv6 only</SelectItem>
                  <SelectItem value="ipv4">IPv4 only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Both resolves AAAA + A with IPv6 preferred ordering.</p>
            </div>
            <InfoAlert>
              Host-level settings can override this default. Resolution happens at config save/reload time and resolved IPs are written into
              Caddy&apos;s active config. If one handler has multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those
              HTTPS upstreams to avoid SNI mismatch.
            </InfoAlert>
            <div className="flex justify-end">
              <Button type="submit">Save upstream DNS pinning settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Authentik Defaults */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Authentik Defaults</h2>
          <p className="text-sm text-muted-foreground">
            Set default Authentik forward authentication values. These will be pre-filled when creating new proxy hosts but can be customized per host.
          </p>
          <form action={authentikFormAction} className="flex flex-col gap-3">
            {authentikState?.message && (
              <StatusAlert message={authentikState.message} success={authentikState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="authentik-override"
                  name="overrideEnabled"
                  checked={authentikOverride}
                  onCheckedChange={(v) => setAuthentikOverride(!!v)}
                />
                <Label htmlFor="authentik-override">Override master settings</Label>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outpostDomain">Outpost Domain</Label>
              <Input
                id="outpostDomain"
                name="outpostDomain"
                placeholder="outpost.goauthentik.io"
                defaultValue={authentik?.outpostDomain ?? ""}
                required
                disabled={isSlave && !authentikOverride}
              />
              <p className="text-xs text-muted-foreground">Authentik outpost domain</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outpostUpstream">Outpost Upstream</Label>
              <Input
                id="outpostUpstream"
                name="outpostUpstream"
                placeholder="http://authentik-server:9000"
                defaultValue={authentik?.outpostUpstream ?? ""}
                required
                disabled={isSlave && !authentikOverride}
              />
              <p className="text-xs text-muted-foreground">Internal URL of Authentik outpost</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="authEndpoint">Authpost Endpoint</Label>
              <Input
                id="authEndpoint"
                name="authEndpoint"
                placeholder="/outpost.goauthentik.io/auth/caddy"
                defaultValue={authentik?.authEndpoint ?? ""}
                disabled={isSlave && !authentikOverride}
              />
              <p className="text-xs text-muted-foreground">Authpost endpoint path</p>
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save Authentik defaults</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Metrics & Monitoring */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Metrics & Monitoring</h2>
          <p className="text-sm text-muted-foreground">
            Enable Caddy metrics exposure for monitoring with Prometheus, Grafana, or other observability tools.
            Metrics will be available at http://caddy:{metrics?.port ?? 9090}/metrics on a separate port (NOT the admin API port for security).
          </p>
          <form action={metricsFormAction} className="flex flex-col gap-3">
            {metricsState?.message && (
              <StatusAlert message={metricsState.message} success={metricsState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="metrics-override"
                  name="overrideEnabled"
                  checked={metricsOverride}
                  onCheckedChange={(v) => setMetricsOverride(!!v)}
                />
                <Label htmlFor="metrics-override">Override master settings</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="metrics-enabled"
                name="enabled"
                defaultChecked={metrics?.enabled ?? false}
                disabled={isSlave && !metricsOverride}
              />
              <Label htmlFor="metrics-enabled">Enable metrics endpoint</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="metrics-port">Metrics Port</Label>
              <Input
                id="metrics-port"
                name="port"
                type="number"
                defaultValue={metrics?.port ?? 9090}
                disabled={isSlave && !metricsOverride}
              />
              <p className="text-xs text-muted-foreground">Port to expose metrics on (default: 9090, separate from admin API on 2019)</p>
            </div>
            <InfoAlert>
              After enabling metrics, configure your monitoring tool to scrape http://caddy-proxy-manager-caddy:{metrics?.port ?? 9090}/metrics from within the Docker network.
              To expose metrics externally, add a port mapping like &ldquo;{metrics?.port ?? 9090}:{metrics?.port ?? 9090}&rdquo; in docker-compose.yml.
            </InfoAlert>
            <div className="flex justify-end">
              <Button type="submit">Save metrics settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Access Logging */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Access Logging</h2>
          <p className="text-sm text-muted-foreground">
            Enable HTTP access logging to track all requests going through your proxy hosts.
            Logs will be stored in the caddy-logs directory and mounted at /logs/access.log inside the container.
          </p>
          <form action={loggingFormAction} className="flex flex-col gap-3">
            {loggingState?.message && (
              <StatusAlert message={loggingState.message} success={loggingState.success} />
            )}
            {isSlave && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="logging-override"
                  name="overrideEnabled"
                  checked={loggingOverride}
                  onCheckedChange={(v) => setLoggingOverride(!!v)}
                />
                <Label htmlFor="logging-override">Override master settings</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="logging-enabled"
                name="enabled"
                defaultChecked={logging?.enabled ?? false}
                disabled={isSlave && !loggingOverride}
              />
              <Label htmlFor="logging-enabled">Enable access logging</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="logging-format">Log Format</Label>
              <Select
                name="format"
                defaultValue={logging?.format ?? "json"}
                disabled={isSlave && !loggingOverride}
              >
                <SelectTrigger id="logging-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="console">Console (Common Log Format)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Format for access logs</p>
            </div>
            <InfoAlert>
              Access logs are stored in the caddy-logs Docker volume.
              You can view them with: docker exec caddy-proxy-manager-caddy tail -f /logs/access.log
            </InfoAlert>
            <div className="flex justify-end">
              <Button type="submit">Save logging settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Global Geoblocking */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h2 className="text-lg font-semibold">Global Geoblocking</h2>
          <p className="text-sm text-muted-foreground">
            Configure default geoblocking rules applied to all proxy hosts. Per-host rules can merge with or override these global defaults.
          </p>
          <form action={geoBlockFormAction} className="flex flex-col gap-3">
            {geoBlockState?.message && (
              <StatusAlert message={geoBlockState.message} success={geoBlockState.success} />
            )}
            <GeoBlockFields
              initialValues={{ geoblock: globalGeoBlock ?? null, geoblock_mode: "merge" }}
              showModeSelector={false}
            />
            <div className="flex justify-end">
              <Button type="submit">Save geoblocking settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
