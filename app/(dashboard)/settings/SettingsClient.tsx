"use client";

import { useState, useActionState } from "react";
import {
  Cloud, Globe, Network, Pin, Activity,
  ScrollText, Settings2, UserCheck, MapPin, KeyRound,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/StatusChip";
import type {
  GeneralSettings,
  AuthentikSettings,
  MetricsSettings,
  LoggingSettings,
  DnsSettings,
  DnsProviderSettings,
  UpstreamDnsResolutionSettings,
  GeoBlockSettings,
} from "@/lib/settings";
import type { DnsProviderDefinition } from "@/src/lib/dns-providers";
import { GeoBlockFields } from "@/components/proxy-hosts/GeoBlockFields";
import OAuthProvidersSection from "./OAuthProvidersSection";
import type { OAuthProvider } from "@/src/lib/models/oauth-providers";
import {
  updateDnsProviderSettingsAction,
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
import { ReactNode } from "react";

// ─── Alert helpers ────────────────────────────────────────────────────────────

function StatusAlert({ message, success }: { message: string; success: boolean }) {
  return (
    <Alert variant={success ? "default" : "destructive"}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function InfoAlert({ children }: { children: ReactNode }) {
  return (
    <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400 [&>svg]:text-blue-500">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function WarnAlert({ children }: { children: ReactNode }) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-500">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

type AccentConfig = { border: string; icon: string };

function SettingSection({
  icon,
  title,
  description,
  accent,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  accent: AccentConfig;
  children: ReactNode;
}) {
  return (
    <Card className={`border-l-2 ${accent.border}`}>
      <CardContent className="flex flex-col gap-4 px-5 pt-5 pb-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.icon}`}>
            {icon}
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ─── Accents ──────────────────────────────────────────────────────────────────

const A: Record<string, AccentConfig> = {
  sync:       { border: "border-l-violet-500",  icon: "border-violet-500/30 bg-violet-500/10 text-violet-500"  },
  general:    { border: "border-l-zinc-400",     icon: "border-zinc-500/30 bg-zinc-500/10 text-zinc-500"        },
  dnsProvider:{ border: "border-l-orange-500",   icon: "border-orange-500/30 bg-orange-500/10 text-orange-500" },
  dns:        { border: "border-l-cyan-500",     icon: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500"        },
  upstreamDns:{ border: "border-l-emerald-500",  icon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" },
  authentik:  { border: "border-l-purple-500",   icon: "border-purple-500/30 bg-purple-500/10 text-purple-500" },
  metrics:    { border: "border-l-rose-500",     icon: "border-rose-500/30 bg-rose-500/10 text-rose-500"        },
  logging:    { border: "border-l-amber-500",    icon: "border-amber-500/30 bg-amber-500/10 text-amber-500"     },
  geoblock:   { border: "border-l-teal-500",     icon: "border-teal-500/30 bg-teal-500/10 text-teal-500"        },
  oauth:      { border: "border-l-indigo-500",   icon: "border-indigo-500/30 bg-indigo-500/10 text-indigo-500" },
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  general: GeneralSettings | null;
  dnsProvider: DnsProviderSettings | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  authentik: AuthentikSettings | null;
  metrics: MetricsSettings | null;
  logging: LoggingSettings | null;
  dns: DnsSettings | null;
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  globalGeoBlock?: GeoBlockSettings | null;
  oauthProviders: OAuthProvider[];
  baseUrl: string;
  instanceSync: {
    mode: "standalone" | "master" | "slave";
    modeFromEnv: boolean;
    tokenFromEnv: boolean;
    overrides: {
      general: boolean;
      dnsProvider: boolean;
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
        baseUrl: string;
        enabled: boolean;
        lastSyncAt: string | null;
        lastSyncError: string | null;
      }>;
      envInstances: Array<{
        name: string;
        url: string;
      }>;
    } | null;
  };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsClient({
  general,
  dnsProvider,
  dnsProviderDefinitions,
  authentik,
  metrics,
  logging,
  dns,
  upstreamDnsResolution,
  globalGeoBlock,
  oauthProviders,
  baseUrl,
  instanceSync
}: Props) {
  const [generalState, generalFormAction] = useActionState(updateGeneralSettingsAction, null);
  const [dnsProviderState, dnsProviderFormAction] = useActionState(updateDnsProviderSettingsAction, null);
  const [selectedProvider, setSelectedProvider] = useState("none");
  const configuredProviders = dnsProvider?.providers ? Object.keys(dnsProvider.providers) : [];
  const [authentikState, authentikFormAction] = useActionState(updateAuthentikSettingsAction, null);
  const [metricsState, metricsFormAction] = useActionState(updateMetricsSettingsAction, null);
  const [loggingState, loggingFormAction] = useActionState(updateLoggingSettingsAction, null);
  const [dnsState, dnsFormAction] = useActionState(updateDnsSettingsAction, null);
  const [upstreamDnsResolutionState, upstreamDnsResolutionFormAction] = useActionState(
    updateUpstreamDnsResolutionSettingsAction, null
  );
  const [instanceModeState, instanceModeFormAction] = useActionState(updateInstanceModeAction, null);
  const [slaveTokenState, slaveTokenFormAction] = useActionState(updateSlaveMasterTokenAction, null);
  const [slaveInstanceState, slaveInstanceFormAction] = useActionState(createSlaveInstanceAction, null);
  const [syncState, syncFormAction] = useActionState(syncSlaveInstancesAction, null);
  const [geoBlockState, geoBlockFormAction] = useActionState(updateGeoBlockSettingsAction, null);

  const isSlave = instanceSync.mode === "slave";
  const isMaster = instanceSync.mode === "master";
  const [generalOverride, setGeneralOverride] = useState(instanceSync.overrides.general);
  const [dnsProviderOverride, setDnsProviderOverride] = useState(instanceSync.overrides.dnsProvider);
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

      {/* ── Instance Sync ── */}
      <SettingSection
        icon={<Network className="h-4 w-4" />}
        title="Instance Sync"
        description="Choose whether this instance acts independently, pushes configuration to slave nodes, or pulls configuration from a master."
        accent={A.sync}
      >
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
          <div className="flex flex-col gap-3 mt-1">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Master Connection</h3>
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
          <div className="flex flex-col gap-3 mt-1">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Slave Instances</h3>
            <form action={slaveInstanceFormAction} className="flex flex-col gap-3">
              {slaveInstanceState?.message && (
                <StatusAlert message={slaveInstanceState.message} success={slaveInstanceState.success} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inst-name">Instance name</Label>
                  <Input id="inst-name" name="name" placeholder="Edge node EU-1" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inst-base-url">Base URL</Label>
                  <Input id="inst-base-url" name="baseUrl" placeholder="https://slave-1.example.com" className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inst-api-token">Slave API token</Label>
                <Input id="inst-api-token" name="apiToken" type="password" autoComplete="new-password" className="h-8 text-sm" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <form action={syncFormAction}>
                  {syncState?.message && (
                    <StatusAlert message={syncState.message} success={syncState.success} />
                  )}
                  <Button type="submit" variant="outline" size="sm">Sync now</Button>
                </form>
                <Button type="submit">Add slave instance</Button>
              </div>
            </form>

            {instanceSync.master?.instances.length === 0 && instanceSync.master?.envInstances.length === 0 && (
              <InfoAlert>No slave instances configured yet.</InfoAlert>
            )}

            {instanceSync.master?.envInstances && instanceSync.master.envInstances.length > 0 && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                  Environment-configured (INSTANCE_SLAVES)
                </p>
                {instanceSync.master.envInstances.map((instance, index) => (
                  <div
                    key={`env-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{instance.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{instance.url}</p>
                    </div>
                    <StatusChip status="active" label="ENV" />
                  </div>
                ))}
              </>
            )}

            {instanceSync.master?.instances && instanceSync.master.instances.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">UI-configured instances</p>
            )}
            {instanceSync.master?.instances.map((instance) => (
              <div
                key={instance.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold">{instance.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{instance.baseUrl}</p>
                  <span className="text-xs text-muted-foreground">
                    {instance.lastSyncAt ? `Last sync: ${instance.lastSyncAt}` : "No sync yet"}
                  </span>
                  {instance.lastSyncError && (
                    <span className="block text-xs text-destructive">{instance.lastSyncError}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <form action={toggleSlaveInstanceAction}>
                    <input type="hidden" name="instanceId" value={instance.id} />
                    <input type="hidden" name="enabled" value={instance.enabled ? "" : "on"} />
                    <Button type="submit" variant="outline" size="sm" className={instance.enabled ? "text-amber-600 border-amber-500/50" : "text-emerald-600 border-emerald-500/50"}>
                      {instance.enabled ? "Disable" : "Enable"}
                    </Button>
                  </form>
                  <form action={deleteSlaveInstanceAction}>
                    <input type="hidden" name="instanceId" value={instance.id} />
                    <Button type="submit" variant="outline" size="sm" className="text-destructive border-destructive/50">
                      Remove
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingSection>

      {/* ── General ── */}
      <SettingSection
        icon={<Settings2 className="h-4 w-4" />}
        title="General"
        accent={A.general}
      >
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="primaryDomain">Primary domain</Label>
              <Input
                id="primaryDomain"
                name="primaryDomain"
                defaultValue={general?.primaryDomain ?? "caddyproxymanager.com"}
                required
                disabled={isSlave && !generalOverride}
                className="h-8 text-sm font-mono"
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
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save general settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── DNS Providers ── */}
      <SettingSection
        icon={<Cloud className="h-4 w-4" />}
        title="DNS Providers"
        description="Configure DNS providers for ACME DNS-01 challenges (required for wildcard certificates). You can add multiple providers and select a default."
        accent={A.dnsProvider}
      >
        {dnsProviderState?.message && (
          <StatusAlert message={dnsProviderState.message} success={dnsProviderState.success} />
        )}
        {isSlave && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="dnsprovider-override"
              name="overrideEnabled"
              form="dnsp-add-form"
              checked={dnsProviderOverride}
              onCheckedChange={(v) => setDnsProviderOverride(!!v)}
            />
            <Label htmlFor="dnsprovider-override">Override master settings</Label>
          </div>
        )}

        {/* Configured providers list */}
        {configuredProviders.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configured providers</Label>
            {configuredProviders.map((name) => {
              const def = dnsProviderDefinitions.find((p) => p.name === name);
              const isDefault = dnsProvider?.default === name;
              return (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 rounded-md border px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{def?.displayName ?? name}</span>
                    {isDefault && <StatusChip status="active" label="Default" />}
                  </div>
                  <div className="flex gap-2">
                    {!isDefault && (
                      <form action={dnsProviderFormAction}>
                        <input type="hidden" name="action" value="set-default" />
                        <input type="hidden" name="provider" value={name} />
                        {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
                        <Button type="submit" variant="outline" size="sm" className="text-emerald-600 border-emerald-500/50">
                          Set default
                        </Button>
                      </form>
                    )}
                    <form action={dnsProviderFormAction}>
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="provider" value={name} />
                      {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
                      <Button type="submit" variant="outline" size="sm" className="text-destructive border-destructive/50">
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
            {dnsProvider?.default && (
              <form action={dnsProviderFormAction}>
                <input type="hidden" name="action" value="set-default" />
                <input type="hidden" name="provider" value="none" />
                {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
                <Button type="submit" variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  Clear default (HTTP-01 only)
                </Button>
              </form>
            )}
          </div>
        )}

        {/* Add / update provider form */}
        <form id="dnsp-add-form" action={dnsProviderFormAction} className="flex flex-col gap-3">
          <input type="hidden" name="action" value="save" />
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {configuredProviders.length > 0 ? "Add or update provider" : "Add a provider"}
          </Label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dns-provider-select">Provider</Label>
            <Select
              name="provider"
              value={selectedProvider}
              onValueChange={setSelectedProvider}
              disabled={isSlave && !dnsProviderOverride}
            >
              <SelectTrigger id="dns-provider-select">
                <SelectValue placeholder="Select a DNS provider..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select...</SelectItem>
                {dnsProviderDefinitions.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.displayName}{configuredProviders.includes(p.name) ? " (update)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic credential fields */}
          {selectedProvider && selectedProvider !== "none" && (() => {
            const providerDef = dnsProviderDefinitions.find((p) => p.name === selectedProvider);
            if (!providerDef) return null;
            const isUpdate = configuredProviders.includes(selectedProvider);
            return (
              <div className="flex flex-col gap-3">
                {providerDef.description && (
                  <p className="text-xs text-muted-foreground">{providerDef.description}</p>
                )}
                {providerDef.fields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`dnsp-${field.key}`} className="text-xs">
                      {field.label}{field.required ? "" : " (optional)"}
                    </Label>
                    <Input
                      id={`dnsp-${field.key}`}
                      name={`credential_${field.key}`}
                      type={field.type === "password" ? "password" : "text"}
                      autoComplete={field.type === "password" ? "new-password" : "off"}
                      placeholder={field.placeholder ?? ""}
                      disabled={isSlave && !dnsProviderOverride}
                      className="h-8 text-sm"
                    />
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                ))}
                {isUpdate && (
                  <InfoAlert>
                    Credentials are already configured. Leave fields blank to keep existing values.
                  </InfoAlert>
                )}
                {providerDef.docsUrl && (
                  <p className="text-xs text-muted-foreground">
                    <a href={providerDef.docsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Provider documentation
                    </a>
                  </p>
                )}
              </div>
            );
          })()}

          {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!selectedProvider || selectedProvider === "none"}>
              {selectedProvider && selectedProvider !== "none" && configuredProviders.includes(selectedProvider) ? "Update provider" : "Add provider"}
            </Button>
          </div>
        </form>
      </SettingSection>

      {/* ── DNS Resolvers ── */}
      <SettingSection
        icon={<Globe className="h-4 w-4" />}
        title="DNS Resolvers"
        description="Configure custom DNS resolvers for ACME DNS-01 challenges. These resolvers will be used to verify DNS records during certificate issuance."
        accent={A.dns}
      >
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-resolvers" className="text-xs">Primary resolvers</Label>
              <textarea
                id="dns-resolvers"
                name="resolvers"
                placeholder={"1.1.1.1\n8.8.8.8"}
                defaultValue={dns?.resolvers?.join("\n") ?? ""}
                rows={2}
                disabled={isSlave && !dnsOverride}
                className="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dns-fallbacks" className="text-xs">Fallback resolvers</Label>
              <textarea
                id="dns-fallbacks"
                name="fallbacks"
                placeholder={"8.8.4.4\n1.0.0.1"}
                defaultValue={dns?.fallbacks?.join("\n") ?? ""}
                rows={2}
                disabled={isSlave && !dnsOverride}
                className="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dns-timeout" className="text-xs">Query timeout</Label>
            <Input
              id="dns-timeout"
              name="timeout"
              placeholder="5s"
              defaultValue={dns?.timeout ?? ""}
              disabled={isSlave && !dnsOverride}
              className="h-8 text-sm w-32"
            />
            <p className="text-xs text-muted-foreground">e.g. 5s, 10s</p>
          </div>
          <InfoAlert>
            Custom DNS resolvers are useful when your DNS provider has slow propagation or when using split-horizon DNS.
            Common public resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
          </InfoAlert>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save DNS settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── Upstream DNS Pinning ── */}
      <SettingSection
        icon={<Pin className="h-4 w-4" />}
        title="Upstream DNS Pinning"
        description="Optionally resolve upstream hostnames at config apply time and pin reverse proxy dials to IP addresses. Avoids runtime DNS churn and lets you force IPv6, IPv4, or both."
        accent={A.upstreamDns}
      >
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
            <Label htmlFor="udns-family">Address family preference</Label>
            <Select
              name="family"
              defaultValue={upstreamDnsResolution?.family ?? "both"}
              disabled={isSlave && !upstreamDnsResolutionOverride}
            >
              <SelectTrigger id="udns-family" className="w-56">
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
            <Button type="submit" size="sm">Save upstream DNS pinning settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── Authentik Defaults ── */}
      <SettingSection
        icon={<UserCheck className="h-4 w-4" />}
        title="Authentik Defaults"
        description="Set default Authentik forward authentication values. These will be pre-filled when creating new proxy hosts but can be customized per host."
        accent={A.authentik}
      >
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outpostDomain">Outpost domain</Label>
              <Input
                id="outpostDomain"
                name="outpostDomain"
                placeholder="outpost.goauthentik.io"
                defaultValue={authentik?.outpostDomain ?? ""}
                required
                disabled={isSlave && !authentikOverride}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outpostUpstream">Outpost upstream</Label>
              <Input
                id="outpostUpstream"
                name="outpostUpstream"
                placeholder="http://authentik-server:9000"
                defaultValue={authentik?.outpostUpstream ?? ""}
                required
                disabled={isSlave && !authentikOverride}
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="authEndpoint">Auth endpoint</Label>
            <Input
              id="authEndpoint"
              name="authEndpoint"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              defaultValue={authentik?.authEndpoint ?? ""}
              disabled={isSlave && !authentikOverride}
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save Authentik defaults</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── Metrics & Monitoring ── */}
      <SettingSection
        icon={<Activity className="h-4 w-4" />}
        title="Metrics & Monitoring"
        description={`Enable Caddy metrics exposure for Prometheus, Grafana, or other observability tools. Metrics will be available at http://caddy:${metrics?.port ?? 9090}/metrics on a dedicated port.`}
        accent={A.metrics}
      >
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
            <Label htmlFor="metrics-port">Metrics port</Label>
            <Input
              id="metrics-port"
              name="port"
              type="number"
              defaultValue={metrics?.port ?? 9090}
              disabled={isSlave && !metricsOverride}
              className="h-8 text-sm w-32 font-mono"
            />
            <p className="text-xs text-muted-foreground">Separate from admin API on port 2019.</p>
          </div>
          <InfoAlert>
            After enabling metrics, configure your monitoring tool to scrape http://caddy-proxy-manager-caddy:{metrics?.port ?? 9090}/metrics from within the Docker network.
            To expose metrics externally, add a port mapping like &ldquo;{metrics?.port ?? 9090}:{metrics?.port ?? 9090}&rdquo; in docker-compose.yml.
          </InfoAlert>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save metrics settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── Access Logging ── */}
      <SettingSection
        icon={<ScrollText className="h-4 w-4" />}
        title="Access Logging"
        description="Enable HTTP access logging to track all requests going through your proxy hosts. Logs are stored in the caddy-logs directory."
        accent={A.logging}
      >
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
            <Label htmlFor="logging-format">Log format</Label>
            <Select
              name="format"
              defaultValue={logging?.format ?? "json"}
              disabled={isSlave && !loggingOverride}
            >
              <SelectTrigger id="logging-format" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="console">Console (Common Log Format)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <InfoAlert>
            Access logs are stored in the caddy-logs Docker volume.
            View with: <code className="text-xs font-mono">docker exec caddy-proxy-manager-caddy tail -f /logs/access.log</code>
          </InfoAlert>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save logging settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── Global Geoblocking ── */}
      <SettingSection
        icon={<MapPin className="h-4 w-4" />}
        title="Global Geoblocking"
        description="Configure default geoblocking rules applied to all proxy hosts. Per-host rules can merge with or override these global defaults."
        accent={A.geoblock}
      >
        <form action={geoBlockFormAction} className="flex flex-col gap-3">
          {geoBlockState?.message && (
            <StatusAlert message={geoBlockState.message} success={geoBlockState.success} />
          )}
          <GeoBlockFields
            initialValues={{ geoblock: globalGeoBlock ?? null, geoblock_mode: "merge" }}
            showModeSelector={false}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save geoblocking settings</Button>
          </div>
        </form>
      </SettingSection>

      {/* ── OAuth Providers ── */}
      <SettingSection
        icon={<KeyRound className="h-4 w-4" />}
        title="OAuth Providers"
        description="Configure OAuth/OIDC providers for single sign-on. Users can log in via these providers in addition to local credentials."
        accent={A.oauth}
      >
        <OAuthProvidersSection initialProviders={oauthProviders} baseUrl={baseUrl} />
      </SettingSection>
    </div>
  );
}
