"use client";

import { useState, useActionState, useEffect, type ReactNode } from "react";
import {
  Cloud, Globe, Network, Pin, Activity,
  ScrollText, Settings2, UserCheck, MapPin, KeyRound,
  Search, ChevronRight,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { cn } from "@/lib/utils";

// ─── Settings navigation catalog ─────────────────────────────────────────────

type SettingItem = {
  id: string;
  name: string;
  desc: string;
  icon: ReactNode;
};

type SettingsGroup = {
  id: string;
  label: string;
  items: SettingItem[];
};

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "system",
    label: "System",
    items: [
      { id: "sync", name: "Instance Sync", desc: "Standalone, master, or slave coordination", icon: <Network className="h-4 w-4" /> },
      { id: "general", name: "General", desc: "Primary domain and ACME contact email", icon: <Settings2 className="h-4 w-4" /> },
    ],
  },
  {
    id: "networking",
    label: "Networking",
    items: [
      { id: "dns-providers", name: "DNS Providers", desc: "Provider credentials for ACME DNS-01", icon: <Cloud className="h-4 w-4" /> },
      { id: "dns-resolvers", name: "DNS Resolvers", desc: "Custom resolvers for challenge verification", icon: <Globe className="h-4 w-4" /> },
      { id: "upstream-dns", name: "Upstream DNS Pinning", desc: "Pin upstream IPs at config-apply time", icon: <Pin className="h-4 w-4" /> },
    ],
  },
  {
    id: "security",
    label: "Security",
    items: [
      { id: "geoblock", name: "Global Geoblocking", desc: "Default geoblock rules across all hosts", icon: <MapPin className="h-4 w-4" /> },
      { id: "authentik", name: "Authentik Defaults", desc: "Forward-auth defaults for new proxy hosts", icon: <UserCheck className="h-4 w-4" /> },
      { id: "oauth", name: "OAuth Providers", desc: "OAuth/OIDC SSO providers", icon: <KeyRound className="h-4 w-4" /> },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    items: [
      { id: "metrics", name: "Metrics & Monitoring", desc: "Prometheus metrics endpoint", icon: <Activity className="h-4 w-4" /> },
      { id: "logging", name: "Access Logging", desc: "HTTP access log for proxied requests", icon: <ScrollText className="h-4 w-4" /> },
    ],
  },
];

const ALL_ITEMS = SETTINGS_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, groupId: g.id, groupLabel: g.label }))
);

function findItem(id: string) {
  return ALL_ITEMS.find((i) => i.id === id);
}

// ─── Alert helpers ───────────────────────────────────────────────────────────

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

// ─── Layout primitives ───────────────────────────────────────────────────────

function FormCard({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      {title && (
        <div className="px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
        </div>
      )}
      <CardContent className="p-4">{children}</CardContent>
      {footer && (
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/30">
          {footer}
        </div>
      )}
    </Card>
  );
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3 py-3 border-b border-border last:border-b-0 items-start">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ─── Cmd-K Palette ───────────────────────────────────────────────────────────

function SettingsCmdK({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a setting..." />
      <CommandList>
        <CommandEmpty>No settings match your search.</CommandEmpty>
        {SETTINGS_GROUPS.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.name} ${item.desc} ${group.label}`}
                onSelect={() => {
                  onSelect(item.id);
                  onOpenChange(false);
                }}
                className="gap-3"
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{item.desc}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

// ─── Settings Sidebar ────────────────────────────────────────────────────────

function SettingsSidebar({
  active,
  onSelect,
  onSearchClick,
}: {
  active: string;
  onSelect: (id: string) => void;
  onSearchClick: () => void;
}) {
  return (
    <aside className="hidden lg:flex flex-col w-[260px] shrink-0 border-r border-border bg-card">
      {/* Search trigger */}
      <div className="p-3 border-b border-border">
        <button
          onClick={onSearchClick}
          className="flex items-center gap-2 w-full h-8 px-2.5 rounded-md border border-border bg-muted/40 text-muted-foreground text-xs hover:bg-muted/60 transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Jump to setting...</span>
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Nav groups */}
      <ScrollArea className="flex-1">
        <nav className="p-2">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="mt-3 first:mt-1">
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              {group.items.map((item) => {
                const isActive = item.id === active;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "relative flex items-center gap-2.5 w-full px-2.5 py-[7px] rounded-md text-sm text-left transition-colors",
                      isActive
                        ? "bg-primary/10 text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                    )}
                    <span className={cn(isActive ? "text-primary" : "text-muted-foreground")}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}

// ─── Mobile settings nav ─────────────────────────────────────────────────────

function MobileSettingsNav({
  active,
  onSelect,
  onSearchClick,
}: {
  active: string;
  onSelect: (id: string) => void;
  onSearchClick: () => void;
}) {
  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onSearchClick}
          className="flex items-center gap-2 flex-1 h-9 px-3 rounded-md border border-border bg-muted/40 text-muted-foreground text-sm hover:bg-muted/60 transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span>Jump to setting...</span>
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-none">
        {ALL_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              item.id === active
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/60"
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Detail header ───────────────────────────────────────────────────────────

function DetailHeader({ activeId }: { activeId: string }) {
  const item = findItem(activeId);
  if (!item) return null;
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border px-6 py-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <span>Settings</span>
        <ChevronRight className="h-3 w-3" />
        <span>{item.groupLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{item.name}</h1>
      </div>
      <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{item.desc}</p>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────────────────

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
  instanceSync,
}: Props) {
  const [active, setActive] = useState("sync");
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Cmd-K keyboard shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Form action states
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
    <div className="flex -mx-4 md:-mx-8 -my-6 min-h-[calc(100vh-3rem)] md:min-h-screen">
      {/* Desktop sidebar */}
      <SettingsSidebar
        active={active}
        onSelect={setActive}
        onSearchClick={() => setCmdkOpen(true)}
      />

      {/* Detail pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        <DetailHeader activeId={active} />

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:px-6 md:py-5 max-w-3xl">
            {/* Mobile nav */}
            <MobileSettingsNav
              active={active}
              onSelect={setActive}
              onSearchClick={() => setCmdkOpen(true)}
            />

            <div className="flex flex-col gap-4">
              {active === "sync" && (
                <SyncSection
                  instanceSync={instanceSync}
                  instanceModeState={instanceModeState}
                  instanceModeFormAction={instanceModeFormAction}
                  slaveTokenState={slaveTokenState}
                  slaveTokenFormAction={slaveTokenFormAction}
                  slaveInstanceState={slaveInstanceState}
                  slaveInstanceFormAction={slaveInstanceFormAction}
                  syncState={syncState}
                  syncFormAction={syncFormAction}
                  isSlave={isSlave}
                  isMaster={isMaster}
                />
              )}
              {active === "general" && (
                <GeneralSection
                  general={general}
                  generalState={generalState}
                  generalFormAction={generalFormAction}
                  isSlave={isSlave}
                  generalOverride={generalOverride}
                  setGeneralOverride={setGeneralOverride}
                />
              )}
              {active === "dns-providers" && (
                <DnsProvidersSection
                  dnsProvider={dnsProvider}
                  dnsProviderDefinitions={dnsProviderDefinitions}
                  dnsProviderState={dnsProviderState}
                  dnsProviderFormAction={dnsProviderFormAction}
                  selectedProvider={selectedProvider}
                  setSelectedProvider={setSelectedProvider}
                  configuredProviders={configuredProviders}
                  isSlave={isSlave}
                  dnsProviderOverride={dnsProviderOverride}
                  setDnsProviderOverride={setDnsProviderOverride}
                />
              )}
              {active === "dns-resolvers" && (
                <DnsResolversSection
                  dns={dns}
                  dnsState={dnsState}
                  dnsFormAction={dnsFormAction}
                  isSlave={isSlave}
                  dnsOverride={dnsOverride}
                  setDnsOverride={setDnsOverride}
                />
              )}
              {active === "upstream-dns" && (
                <UpstreamDnsSection
                  upstreamDnsResolution={upstreamDnsResolution}
                  upstreamDnsResolutionState={upstreamDnsResolutionState}
                  upstreamDnsResolutionFormAction={upstreamDnsResolutionFormAction}
                  isSlave={isSlave}
                  upstreamDnsResolutionOverride={upstreamDnsResolutionOverride}
                  setUpstreamDnsResolutionOverride={setUpstreamDnsResolutionOverride}
                />
              )}
              {active === "geoblock" && (
                <GeoBlockSection
                  globalGeoBlock={globalGeoBlock}
                  geoBlockState={geoBlockState}
                  geoBlockFormAction={geoBlockFormAction}
                />
              )}
              {active === "authentik" && (
                <AuthentikSection
                  authentik={authentik}
                  authentikState={authentikState}
                  authentikFormAction={authentikFormAction}
                  isSlave={isSlave}
                  authentikOverride={authentikOverride}
                  setAuthentikOverride={setAuthentikOverride}
                />
              )}
              {active === "oauth" && (
                <OAuthSection
                  oauthProviders={oauthProviders}
                  baseUrl={baseUrl}
                />
              )}
              {active === "metrics" && (
                <MetricsSection
                  metrics={metrics}
                  metricsState={metricsState}
                  metricsFormAction={metricsFormAction}
                  isSlave={isSlave}
                  metricsOverride={metricsOverride}
                  setMetricsOverride={setMetricsOverride}
                />
              )}
              {active === "logging" && (
                <LoggingSection
                  logging={logging}
                  loggingState={loggingState}
                  loggingFormAction={loggingFormAction}
                  isSlave={isSlave}
                  loggingOverride={loggingOverride}
                  setLoggingOverride={setLoggingOverride}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cmd-K palette */}
      <SettingsCmdK open={cmdkOpen} onOpenChange={setCmdkOpen} onSelect={setActive} />
    </div>
  );
}

// ─── Section: Instance Sync ──────────────────────────────────────────────────

function SyncSection({
  instanceSync,
  instanceModeState,
  instanceModeFormAction,
  slaveTokenState,
  slaveTokenFormAction,
  slaveInstanceState,
  slaveInstanceFormAction,
  syncState,
  syncFormAction,
  isSlave,
  isMaster,
}: {
  instanceSync: Props["instanceSync"];
  instanceModeState: { success: boolean; message?: string } | null;
  instanceModeFormAction: (payload: FormData) => void;
  slaveTokenState: { success: boolean; message?: string } | null;
  slaveTokenFormAction: (payload: FormData) => void;
  slaveInstanceState: { success: boolean; message?: string } | null;
  slaveInstanceFormAction: (payload: FormData) => void;
  syncState: { success: boolean; message?: string } | null;
  syncFormAction: (payload: FormData) => void;
  isSlave: boolean;
  isMaster: boolean;
}) {
  return (
    <>
      <FormCard title="Mode">
        <form action={instanceModeFormAction} className="flex flex-col gap-3">
          {instanceSync.modeFromEnv && (
            <InfoAlert>
              Instance mode is configured via INSTANCE_MODE environment variable and cannot be changed at runtime.
            </InfoAlert>
          )}
          {instanceModeState?.message && (
            <StatusAlert message={instanceModeState.message} success={instanceModeState.success} />
          )}
          <FormRow label="Instance mode" hint="Standalone runs alone. Master pushes config to slaves. Slave pulls from a master.">
            <Select name="mode" defaultValue={instanceSync.mode} disabled={instanceSync.modeFromEnv}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standalone">Standalone</SelectItem>
                <SelectItem value="master">Master</SelectItem>
                <SelectItem value="slave">Slave</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={instanceSync.modeFromEnv}>
              Save instance mode
            </Button>
          </div>
        </form>
      </FormCard>

      {isSlave && (
        <FormCard title="Master Connection">
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
            <FormRow label="Master sync token">
              <Input
                name="masterToken"
                type="password"
                autoComplete="new-password"
                placeholder="Enter new token"
                disabled={instanceSync.tokenFromEnv}
                className="h-8 text-sm"
              />
            </FormRow>
            <div className="flex items-center gap-2 px-0.5">
              <Checkbox
                id="clearToken"
                name="clearToken"
                disabled={!instanceSync.slave?.hasToken || instanceSync.tokenFromEnv}
              />
              <Label htmlFor="clearToken">Remove existing token</Label>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={instanceSync.tokenFromEnv}>
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
        </FormCard>
      )}

      {isMaster && (
        <FormCard title={`Slave Instances (${(instanceSync.master?.instances.length ?? 0) + (instanceSync.master?.envInstances.length ?? 0)})`}>
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
              <Button type="submit" size="sm">Add slave instance</Button>
            </div>
          </form>

          {instanceSync.master?.instances.length === 0 && instanceSync.master?.envInstances.length === 0 && (
            <div className="mt-3">
              <InfoAlert>No slave instances configured yet.</InfoAlert>
            </div>
          )}

          {instanceSync.master?.envInstances && instanceSync.master.envInstances.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
            </div>
          )}

          {instanceSync.master?.instances && instanceSync.master.instances.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">UI-configured instances</p>
              {instanceSync.master.instances.map((instance) => (
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
        </FormCard>
      )}
    </>
  );
}

// ─── Section: General ────────────────────────────────────────────────────────

function GeneralSection({
  general,
  generalState,
  generalFormAction,
  isSlave,
  generalOverride,
  setGeneralOverride,
}: {
  general: GeneralSettings | null;
  generalState: { success: boolean; message?: string } | null;
  generalFormAction: (payload: FormData) => void;
  isSlave: boolean;
  generalOverride: boolean;
  setGeneralOverride: (v: boolean) => void;
}) {
  return (
    <FormCard title="Defaults">
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
        <FormRow label="Primary domain" hint="Default domain shown when creating new proxy hosts.">
          <Input
            name="primaryDomain"
            defaultValue={general?.primaryDomain ?? "caddyproxymanager.com"}
            required
            disabled={isSlave && !generalOverride}
            className="h-8 text-sm font-mono"
          />
        </FormRow>
        <FormRow label="ACME contact email" hint="Used by Let's Encrypt for expiry notifications.">
          <Input
            name="acmeEmail"
            type="email"
            defaultValue={general?.acmeEmail ?? ""}
            disabled={isSlave && !generalOverride}
            className="h-8 text-sm"
          />
        </FormRow>
        <div className="flex justify-end">
          <Button type="submit" size="sm">Save general settings</Button>
        </div>
      </form>
    </FormCard>
  );
}

// ─── Section: DNS Providers ──────────────────────────────────────────────────

function DnsProvidersSection({
  dnsProvider,
  dnsProviderDefinitions,
  dnsProviderState,
  dnsProviderFormAction,
  selectedProvider,
  setSelectedProvider,
  configuredProviders,
  isSlave,
  dnsProviderOverride,
  setDnsProviderOverride,
}: {
  dnsProvider: DnsProviderSettings | null;
  dnsProviderDefinitions: DnsProviderDefinition[];
  dnsProviderState: { success: boolean; message?: string } | null;
  dnsProviderFormAction: (payload: FormData) => void;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  configuredProviders: string[];
  isSlave: boolean;
  dnsProviderOverride: boolean;
  setDnsProviderOverride: (v: boolean) => void;
}) {
  return (
    <>
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

      {/* Configured providers */}
      {configuredProviders.length > 0 && (
        <FormCard title="Configured providers">
          <div className="flex flex-col gap-2.5">
            {configuredProviders.map((name) => {
              const def = dnsProviderDefinitions.find((p) => p.name === name);
              const isDefault = dnsProvider?.default === name;
              return (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 bg-muted/20"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold">{def?.displayName ?? name}</span>
                    {isDefault && <Badge variant="default" className="text-[10px]">Default</Badge>}
                  </div>
                  <div className="flex gap-2">
                    {!isDefault && (
                      <form action={dnsProviderFormAction}>
                        <input type="hidden" name="action" value="set-default" />
                        <input type="hidden" name="provider" value={name} />
                        {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
                        <Button type="submit" variant="outline" size="sm">
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
        </FormCard>
      )}

      {/* Add provider form */}
      <FormCard
        title={configuredProviders.length > 0 ? "Add or update provider" : "Add a provider"}
        footer={
          <>
            {isSlave && <input type="hidden" name="overrideEnabled" form="dnsp-add-form" value={dnsProviderOverride ? "on" : ""} />}
            <Button type="submit" form="dnsp-add-form" size="sm" disabled={!selectedProvider || selectedProvider === "none"}>
              {selectedProvider && selectedProvider !== "none" && configuredProviders.includes(selectedProvider) ? "Update provider" : "Add provider"}
            </Button>
          </>
        }
      >
        <form id="dnsp-add-form" action={dnsProviderFormAction} className="flex flex-col gap-3">
          <input type="hidden" name="action" value="save" />
          <FormRow label="Provider" hint={`${dnsProviderDefinitions.length} providers supported`}>
            <Select
              name="provider"
              value={selectedProvider}
              onValueChange={setSelectedProvider}
              disabled={isSlave && !dnsProviderOverride}
            >
              <SelectTrigger>
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
          </FormRow>

          {/* Dynamic credential fields */}
          {selectedProvider && selectedProvider !== "none" && (() => {
            const providerDef = dnsProviderDefinitions.find((p) => p.name === selectedProvider);
            if (!providerDef) return null;
            const isUpdate = configuredProviders.includes(selectedProvider);
            return (
              <>
                {providerDef.description && (
                  <p className="text-xs text-muted-foreground">{providerDef.description}</p>
                )}
                {providerDef.fields.map((field) => (
                  <FormRow key={field.key} label={field.label + (field.required ? "" : " (optional)")}>
                    <div className="flex flex-col gap-1">
                      <Input
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
                  </FormRow>
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
              </>
            );
          })()}
          {isSlave && <input type="hidden" name="overrideEnabled" value={dnsProviderOverride ? "on" : ""} />}
        </form>
      </FormCard>
    </>
  );
}

// ─── Section: DNS Resolvers ──────────────────────────────────────────────────

function DnsResolversSection({
  dns,
  dnsState,
  dnsFormAction,
  isSlave,
  dnsOverride,
  setDnsOverride,
}: {
  dns: DnsSettings | null;
  dnsState: { success: boolean; message?: string } | null;
  dnsFormAction: (payload: FormData) => void;
  isSlave: boolean;
  dnsOverride: boolean;
  setDnsOverride: (v: boolean) => void;
}) {
  return (
    <>
      <FormCard>
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
          <FormRow label="Custom resolvers">
            <div className="flex items-center gap-2">
              <Checkbox
                id="dns-enabled"
                name="enabled"
                defaultChecked={dns?.enabled ?? false}
                disabled={isSlave && !dnsOverride}
              />
              <Label htmlFor="dns-enabled">Enable custom DNS resolvers</Label>
            </div>
          </FormRow>
          <FormRow label="Primary resolvers">
            <textarea
              name="resolvers"
              placeholder={"1.1.1.1\n8.8.8.8"}
              defaultValue={dns?.resolvers?.join("\n") ?? ""}
              rows={2}
              disabled={isSlave && !dnsOverride}
              className="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </FormRow>
          <FormRow label="Fallback resolvers">
            <textarea
              name="fallbacks"
              placeholder={"8.8.4.4\n1.0.0.1"}
              defaultValue={dns?.fallbacks?.join("\n") ?? ""}
              rows={2}
              disabled={isSlave && !dnsOverride}
              className="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </FormRow>
          <FormRow label="Query timeout" hint="e.g. 5s, 10s">
            <Input
              name="timeout"
              placeholder="5s"
              defaultValue={dns?.timeout ?? ""}
              disabled={isSlave && !dnsOverride}
              className="h-8 text-sm w-32"
            />
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save DNS settings</Button>
          </div>
        </form>
      </FormCard>
      <InfoAlert>
        Custom DNS resolvers are useful when your DNS provider has slow propagation or when using split-horizon DNS.
        Common public resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
      </InfoAlert>
    </>
  );
}

// ─── Section: Upstream DNS Pinning ───────────────────────────────────────────

function UpstreamDnsSection({
  upstreamDnsResolution,
  upstreamDnsResolutionState,
  upstreamDnsResolutionFormAction,
  isSlave,
  upstreamDnsResolutionOverride,
  setUpstreamDnsResolutionOverride,
}: {
  upstreamDnsResolution: UpstreamDnsResolutionSettings | null;
  upstreamDnsResolutionState: { success: boolean; message?: string } | null;
  upstreamDnsResolutionFormAction: (payload: FormData) => void;
  isSlave: boolean;
  upstreamDnsResolutionOverride: boolean;
  setUpstreamDnsResolutionOverride: (v: boolean) => void;
}) {
  return (
    <>
      <FormCard>
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
          <FormRow label="Pin upstream IPs" hint="Resolves upstream hostnames at config-apply time and writes IPs into Caddy's active config.">
            <div className="flex items-center gap-2">
              <Checkbox
                id="udns-enabled"
                name="enabled"
                defaultChecked={upstreamDnsResolution?.enabled ?? false}
                disabled={isSlave && !upstreamDnsResolutionOverride}
              />
              <Label htmlFor="udns-enabled">Enable upstream DNS pinning</Label>
            </div>
          </FormRow>
          <FormRow label="Address family" hint="Both resolves AAAA + A with IPv6 preferred ordering.">
            <Select
              name="family"
              defaultValue={upstreamDnsResolution?.family ?? "both"}
              disabled={isSlave && !upstreamDnsResolutionOverride}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Both (Prefer IPv6)</SelectItem>
                <SelectItem value="ipv6">IPv6 only</SelectItem>
                <SelectItem value="ipv4">IPv4 only</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save upstream DNS pinning settings</Button>
          </div>
        </form>
      </FormCard>
      <InfoAlert>
        Host-level settings can override this default. Resolution happens at config save/reload time and resolved IPs are written into
        Caddy&apos;s active config. If one handler has multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those
        HTTPS upstreams to avoid SNI mismatch.
      </InfoAlert>
    </>
  );
}

// ─── Section: Global Geoblocking ─────────────────────────────────────────────

function GeoBlockSection({
  globalGeoBlock,
  geoBlockState,
  geoBlockFormAction,
}: {
  globalGeoBlock?: GeoBlockSettings | null;
  geoBlockState: { success: boolean; message?: string } | null;
  geoBlockFormAction: (payload: FormData) => void;
}) {
  return (
    <FormCard>
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
    </FormCard>
  );
}

// ─── Section: Authentik Defaults ─────────────────────────────────────────────

function AuthentikSection({
  authentik,
  authentikState,
  authentikFormAction,
  isSlave,
  authentikOverride,
  setAuthentikOverride,
}: {
  authentik: AuthentikSettings | null;
  authentikState: { success: boolean; message?: string } | null;
  authentikFormAction: (payload: FormData) => void;
  isSlave: boolean;
  authentikOverride: boolean;
  setAuthentikOverride: (v: boolean) => void;
}) {
  return (
    <FormCard>
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
        <FormRow label="Outpost domain">
          <Input
            name="outpostDomain"
            placeholder="outpost.goauthentik.io"
            defaultValue={authentik?.outpostDomain ?? ""}
            required
            disabled={isSlave && !authentikOverride}
            className="h-8 text-sm font-mono"
          />
        </FormRow>
        <FormRow label="Outpost upstream">
          <Input
            name="outpostUpstream"
            placeholder="http://authentik-server:9000"
            defaultValue={authentik?.outpostUpstream ?? ""}
            required
            disabled={isSlave && !authentikOverride}
            className="h-8 text-sm font-mono"
          />
        </FormRow>
        <FormRow label="Auth endpoint">
          <Input
            name="authEndpoint"
            placeholder="/outpost.goauthentik.io/auth/caddy"
            defaultValue={authentik?.authEndpoint ?? ""}
            disabled={isSlave && !authentikOverride}
            className="h-8 text-sm font-mono"
          />
        </FormRow>
        <div className="flex justify-end">
          <Button type="submit" size="sm">Save Authentik defaults</Button>
        </div>
      </form>
    </FormCard>
  );
}

// ─── Section: OAuth Providers ────────────────────────────────────────────────

function OAuthSection({
  oauthProviders,
  baseUrl,
}: {
  oauthProviders: OAuthProvider[];
  baseUrl: string;
}) {
  return (
    <FormCard>
      <OAuthProvidersSection initialProviders={oauthProviders} baseUrl={baseUrl} />
    </FormCard>
  );
}

// ─── Section: Metrics & Monitoring ───────────────────────────────────────────

function MetricsSection({
  metrics,
  metricsState,
  metricsFormAction,
  isSlave,
  metricsOverride,
  setMetricsOverride,
}: {
  metrics: MetricsSettings | null;
  metricsState: { success: boolean; message?: string } | null;
  metricsFormAction: (payload: FormData) => void;
  isSlave: boolean;
  metricsOverride: boolean;
  setMetricsOverride: (v: boolean) => void;
}) {
  return (
    <>
      <FormCard>
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
          <FormRow label="Metrics endpoint" hint="Prometheus-compatible scrape endpoint, exposed on a dedicated port.">
            <div className="flex items-center gap-2">
              <Checkbox
                id="metrics-enabled"
                name="enabled"
                defaultChecked={metrics?.enabled ?? false}
                disabled={isSlave && !metricsOverride}
              />
              <Label htmlFor="metrics-enabled">Enable metrics endpoint</Label>
            </div>
          </FormRow>
          <FormRow label="Port" hint="Separate from admin API on port 2019.">
            <Input
              name="port"
              type="number"
              defaultValue={metrics?.port ?? 9090}
              disabled={isSlave && !metricsOverride}
              className="h-8 text-sm w-32 font-mono"
            />
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save metrics settings</Button>
          </div>
        </form>
      </FormCard>
      <InfoAlert>
        Configure your monitoring tool to scrape <code className="text-xs font-mono">http://caddy-proxy-manager-caddy:{metrics?.port ?? 9090}/metrics</code> from within the Docker network.
      </InfoAlert>
    </>
  );
}

// ─── Section: Access Logging ─────────────────────────────────────────────────

function LoggingSection({
  logging,
  loggingState,
  loggingFormAction,
  isSlave,
  loggingOverride,
  setLoggingOverride,
}: {
  logging: LoggingSettings | null;
  loggingState: { success: boolean; message?: string } | null;
  loggingFormAction: (payload: FormData) => void;
  isSlave: boolean;
  loggingOverride: boolean;
  setLoggingOverride: (v: boolean) => void;
}) {
  return (
    <>
      <FormCard>
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
          <FormRow label="Access logging">
            <div className="flex items-center gap-2">
              <Checkbox
                id="logging-enabled"
                name="enabled"
                defaultChecked={logging?.enabled ?? false}
                disabled={isSlave && !loggingOverride}
              />
              <Label htmlFor="logging-enabled">Enable access logging</Label>
            </div>
          </FormRow>
          <FormRow label="Format">
            <Select
              name="format"
              defaultValue={logging?.format ?? "json"}
              disabled={isSlave && !loggingOverride}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="console">Console (Common Log Format)</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" size="sm">Save logging settings</Button>
          </div>
        </form>
      </FormCard>
      <InfoAlert>
        Access logs are stored in the caddy-logs Docker volume.
        View with: <code className="text-xs font-mono">docker exec caddy-proxy-manager-caddy tail -f /logs/access.log</code>
      </InfoAlert>
    </>
  );
}
