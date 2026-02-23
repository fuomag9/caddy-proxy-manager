"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type {
  GeneralSettings,
  AuthentikSettings,
  MetricsSettings,
  LoggingSettings,
  DnsSettings,
  UpstreamDnsResolutionSettings,
  GeoBlockSettings
} from "@/src/lib/settings";
import { GeoBlockFields } from "@/src/components/proxy-hosts/GeoBlockFields";
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
  updateGeoBlockSettingsAction
} from "./actions";

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
    <Stack spacing={4} sx={{ width: "100%" }}>
      <Stack spacing={1}>
        <Typography variant="h4" fontWeight={600}>
          Settings
        </Typography>
        <Typography color="text.secondary">Configure organization-wide defaults and DNS automation.</Typography>
      </Stack>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Instance Sync
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Choose whether this instance acts independently, pushes configuration to slave nodes, or pulls configuration from a master.
          </Typography>
          <Stack component="form" action={instanceModeFormAction} spacing={2}>
            {instanceSync.modeFromEnv && (
              <Alert severity="info">
                Instance mode is configured via INSTANCE_MODE environment variable and cannot be changed at runtime.
              </Alert>
            )}
            {instanceModeState?.message && (
              <Alert severity={instanceModeState.success ? "success" : "error"}>
                {instanceModeState.message}
              </Alert>
            )}
            <TextField
              name="mode"
              label="Instance mode"
              select
              defaultValue={instanceSync.mode}
              disabled={instanceSync.modeFromEnv}
              fullWidth
            >
              <MenuItem value="standalone">Standalone</MenuItem>
              <MenuItem value="master">Master</MenuItem>
              <MenuItem value="slave">Slave</MenuItem>
            </TextField>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained" disabled={instanceSync.modeFromEnv}>
                Save instance mode
              </Button>
            </Box>
          </Stack>

          {isSlave && (
            <Stack spacing={2} sx={{ mt: 3 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Master Connection
              </Typography>
              <Stack component="form" action={slaveTokenFormAction} spacing={2}>
                {instanceSync.tokenFromEnv && (
                  <Alert severity="info">
                    Sync token is configured via INSTANCE_SYNC_TOKEN environment variable and cannot be changed at runtime.
                  </Alert>
                )}
                {slaveTokenState?.message && (
                  <Alert severity={slaveTokenState.success ? "success" : "error"}>
                    {slaveTokenState.message}
                  </Alert>
                )}
                {instanceSync.slave?.hasToken && !instanceSync.tokenFromEnv && (
                  <Alert severity="info">
                    A master sync token is configured. Leave the token field blank to keep it, or select "Remove existing token" to delete it.
                  </Alert>
                )}
                <TextField
                  name="masterToken"
                  label="Master sync token"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter new token"
                  disabled={instanceSync.tokenFromEnv}
                  fullWidth
                />
                <FormControlLabel
                  control={<Checkbox name="clearToken" />}
                  label="Remove existing token"
                  disabled={!instanceSync.slave?.hasToken || instanceSync.tokenFromEnv}
                />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button type="submit" variant="contained" disabled={instanceSync.tokenFromEnv}>
                    Save master token
                  </Button>
                </Box>
              </Stack>
              <Alert severity={instanceSync.slave?.lastSyncError ? "warning" : "info"}>
                {instanceSync.slave?.lastSyncAt
                  ? `Last sync: ${instanceSync.slave.lastSyncAt}${instanceSync.slave.lastSyncError ? ` (${instanceSync.slave.lastSyncError})` : ""}`
                  : "No sync payload has been received yet."}
              </Alert>
            </Stack>
          )}

          {isMaster && (
            <Stack spacing={2} sx={{ mt: 3 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Slave Instances
              </Typography>
              <Stack component="form" action={slaveInstanceFormAction} spacing={2}>
                {slaveInstanceState?.message && (
                  <Alert severity={slaveInstanceState.success ? "success" : "error"}>
                    {slaveInstanceState.message}
                  </Alert>
                )}
                <TextField name="name" label="Instance name" placeholder="Edge node EU-1" fullWidth />
                <TextField name="baseUrl" label="Base URL" placeholder="https://slave-1.example.com" fullWidth />
                <TextField name="apiToken" label="Slave API token" type="password" autoComplete="new-password" fullWidth />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button type="submit" variant="contained">
                    Add slave instance
                  </Button>
                </Box>
              </Stack>

              <Stack component="form" action={syncFormAction} spacing={2}>
                {syncState?.message && (
                  <Alert severity={syncState.success ? "success" : "warning"}>
                    {syncState.message}
                  </Alert>
                )}
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button type="submit" variant="outlined">
                    Sync now
                  </Button>
                </Box>
              </Stack>

              {instanceSync.master?.instances.length === 0 && instanceSync.master?.envInstances.length === 0 && (
                <Alert severity="info">No slave instances configured yet.</Alert>
              )}

              {instanceSync.master?.envInstances && instanceSync.master.envInstances.length > 0 && (
                <>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
                    Environment-configured instances (via INSTANCE_SLAVES)
                  </Typography>
                  {instanceSync.master.envInstances.map((instance, index) => (
                    <Box
                      key={`env-${index}`}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 2,
                        p: 2,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 2,
                        bgcolor: "action.hover"
                      }}
                    >
                      <Box>
                        <Typography fontWeight={600}>{instance.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {instance.url}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Configured via environment variable
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}

              {instanceSync.master?.instances && instanceSync.master.instances.length > 0 && (
                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
                  UI-configured instances
                </Typography>
              )}
              {instanceSync.master?.instances.map((instance) => (
                <Box
                  key={instance.id}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 2,
                    p: 2,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 2
                  }}
                >
                  <Box>
                    <Typography fontWeight={600}>{instance.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {instance.base_url}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {instance.last_sync_at ? `Last sync: ${instance.last_sync_at}` : "No sync yet"}
                    </Typography>
                    {instance.last_sync_error && (
                      <Typography variant="caption" color="error" display="block">
                        {instance.last_sync_error}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Box component="form" action={toggleSlaveInstanceAction}>
                      <input type="hidden" name="instanceId" value={instance.id} />
                      <input type="hidden" name="enabled" value={instance.enabled ? "" : "on"} />
                      <Button type="submit" variant="outlined" color={instance.enabled ? "warning" : "success"}>
                        {instance.enabled ? "Disable" : "Enable"}
                      </Button>
                    </Box>
                    <Box component="form" action={deleteSlaveInstanceAction}>
                      <input type="hidden" name="instanceId" value={instance.id} />
                      <Button type="submit" variant="outlined" color="error">
                        Remove
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            General
          </Typography>
          <Stack component="form" action={generalFormAction} spacing={2}>
            {generalState?.message && (
              <Alert severity={generalState.success ? "success" : "error"}>
                {generalState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={generalOverride}
                    onChange={(event) => setGeneralOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <TextField
              name="primaryDomain"
              label="Primary domain"
              defaultValue={general?.primaryDomain ?? "caddyproxymanager.com"}
              required
              disabled={isSlave && !generalOverride}
              fullWidth
            />
            <TextField
              name="acmeEmail"
              label="ACME contact email"
              type="email"
              defaultValue={general?.acmeEmail ?? ""}
              disabled={isSlave && !generalOverride}
              fullWidth
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save general settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Cloudflare DNS
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Configure a Cloudflare API token with Zone.DNS Edit permissions to enable DNS-01 challenges for wildcard certificates.
          </Typography>
          {cloudflare.hasToken && (
            <Alert severity="info">
              A Cloudflare API token is already configured. Leave the token field blank to keep it, or select “Remove existing token” to delete it.
            </Alert>
          )}
          <Stack component="form" action={cloudflareFormAction} spacing={2}>
            {cloudflareState?.message && (
              <Alert severity={cloudflareState.success ? "success" : "warning"}>
                {cloudflareState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={cloudflareOverride}
                    onChange={(event) => setCloudflareOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <TextField
              name="apiToken"
              label="API token"
              type="password"
              autoComplete="new-password"
              placeholder="Enter new token"
              disabled={isSlave && !cloudflareOverride}
              fullWidth
            />
            <FormControlLabel
              control={<Checkbox name="clearToken" />}
              label="Remove existing token"
              disabled={!cloudflare.hasToken || (isSlave && !cloudflareOverride)}
            />
            <TextField name="zoneId" label="Zone ID" defaultValue={cloudflare.zoneId ?? ""} disabled={isSlave && !cloudflareOverride} fullWidth />
            <TextField name="accountId" label="Account ID" defaultValue={cloudflare.accountId ?? ""} disabled={isSlave && !cloudflareOverride} fullWidth />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save Cloudflare settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            DNS Resolvers
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Configure custom DNS resolvers for ACME DNS-01 challenges. These resolvers will be used to verify DNS records during certificate issuance.
          </Typography>
          <Stack component="form" action={dnsFormAction} spacing={2}>
            {dnsState?.message && (
              <Alert severity={dnsState.success ? "success" : "error"}>
                {dnsState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={dnsOverride}
                    onChange={(event) => setDnsOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={dns?.enabled ?? false} disabled={isSlave && !dnsOverride} />}
              label="Enable custom DNS resolvers"
            />
            <TextField
              name="resolvers"
              label="Primary DNS Resolvers"
              placeholder="1.1.1.1&#10;8.8.8.8"
              defaultValue={dns?.resolvers?.join("\n") ?? ""}
              helperText="One resolver per line (e.g., 1.1.1.1, 8.8.8.8). Used for ACME DNS verification."
              multiline
              minRows={2}
              disabled={isSlave && !dnsOverride}
              fullWidth
            />
            <TextField
              name="fallbacks"
              label="Fallback DNS Resolvers (Optional)"
              placeholder="8.8.4.4&#10;1.0.0.1"
              defaultValue={dns?.fallbacks?.join("\n") ?? ""}
              helperText="Fallback resolvers if primary fails. One per line."
              multiline
              minRows={2}
              disabled={isSlave && !dnsOverride}
              fullWidth
            />
            <TextField
              name="timeout"
              label="DNS Query Timeout"
              placeholder="5s"
              defaultValue={dns?.timeout ?? ""}
              helperText="Timeout for DNS queries (e.g., 5s, 10s)"
              disabled={isSlave && !dnsOverride}
              fullWidth
            />
            <Alert severity="info">
              Custom DNS resolvers are useful when your DNS provider has slow propagation or when using split-horizon DNS.
              Common public resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save DNS settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Upstream DNS Pinning
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Optionally resolve upstream hostnames when applying config and pin reverse proxy upstream dials to IP addresses.
            This can avoid runtime DNS churn and lets you force IPv6, IPv4, or both (IPv6 preferred).
          </Typography>
          <Stack component="form" action={upstreamDnsResolutionFormAction} spacing={2}>
            {upstreamDnsResolutionState?.message && (
              <Alert severity={upstreamDnsResolutionState.success ? "success" : "error"}>
                {upstreamDnsResolutionState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={upstreamDnsResolutionOverride}
                    onChange={(event) => setUpstreamDnsResolutionOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={upstreamDnsResolution?.enabled ?? false} disabled={isSlave && !upstreamDnsResolutionOverride} />}
              label="Enable upstream DNS pinning during config apply"
            />
            <TextField
              name="family"
              label="Address Family Preference"
              select
              defaultValue={upstreamDnsResolution?.family ?? "both"}
              helperText="Both resolves AAAA + A with IPv6 preferred ordering."
              disabled={isSlave && !upstreamDnsResolutionOverride}
              fullWidth
            >
              <MenuItem value="both">Both (Prefer IPv6)</MenuItem>
              <MenuItem value="ipv6">IPv6 only</MenuItem>
              <MenuItem value="ipv4">IPv4 only</MenuItem>
            </TextField>
            <Alert severity="info">
              Host-level settings can override this default. Resolution happens at config save/reload time and resolved IPs are written into
              Caddy's active config. If one handler has multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those
              HTTPS upstreams to avoid SNI mismatch.
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save upstream DNS pinning settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Authentik Defaults
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Set default Authentik forward authentication values. These will be pre-filled when creating new proxy hosts but can be customized per host.
          </Typography>
          <Stack component="form" action={authentikFormAction} spacing={2}>
            {authentikState?.message && (
              <Alert severity={authentikState.success ? "success" : "error"}>
                {authentikState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={authentikOverride}
                    onChange={(event) => setAuthentikOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <TextField
              name="outpostDomain"
              label="Outpost Domain"
              placeholder="outpost.goauthentik.io"
              defaultValue={authentik?.outpostDomain ?? ""}
              helperText="Authentik outpost domain"
              required
              disabled={isSlave && !authentikOverride}
              fullWidth
            />
            <TextField
              name="outpostUpstream"
              label="Outpost Upstream"
              placeholder="http://authentik-server:9000"
              defaultValue={authentik?.outpostUpstream ?? ""}
              helperText="Internal URL of Authentik outpost"
              required
              disabled={isSlave && !authentikOverride}
              fullWidth
            />
            <TextField
              name="authEndpoint"
              label="Authpost Endpoint"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              defaultValue={authentik?.authEndpoint ?? ""}
              helperText="Authpost endpoint path"
              disabled={isSlave && !authentikOverride}
              fullWidth
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save Authentik defaults
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Metrics & Monitoring
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Enable Caddy metrics exposure for monitoring with Prometheus, Grafana, or other observability tools.
            Metrics will be available at http://caddy:{metrics?.port ?? 9090}/metrics on a separate port (NOT the admin API port for security).
          </Typography>
          <Stack component="form" action={metricsFormAction} spacing={2}>
            {metricsState?.message && (
              <Alert severity={metricsState.success ? "success" : "warning"}>
                {metricsState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={metricsOverride}
                    onChange={(event) => setMetricsOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={metrics?.enabled ?? false} disabled={isSlave && !metricsOverride} />}
              label="Enable metrics endpoint"
            />
            <TextField
              name="port"
              label="Metrics Port"
              type="number"
              defaultValue={metrics?.port ?? 9090}
              helperText="Port to expose metrics on (default: 9090, separate from admin API on 2019)"
              disabled={isSlave && !metricsOverride}
              fullWidth
            />
            <Alert severity="info">
              After enabling metrics, configure your monitoring tool to scrape http://caddy-proxy-manager-caddy:{metrics?.port ?? 9090}/metrics from within the Docker network.
              To expose metrics externally, add a port mapping like "{metrics?.port ?? 9090}:{metrics?.port ?? 9090}" in docker-compose.yml.
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save metrics settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Access Logging
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Enable HTTP access logging to track all requests going through your proxy hosts.
            Logs will be stored in the caddy-logs directory and mounted at /logs/access.log inside the container.
          </Typography>
          <Stack component="form" action={loggingFormAction} spacing={2}>
            {loggingState?.message && (
              <Alert severity={loggingState.success ? "success" : "warning"}>
                {loggingState.message}
              </Alert>
            )}
            {isSlave && (
              <FormControlLabel
                control={
                  <Checkbox
                    name="overrideEnabled"
                    checked={loggingOverride}
                    onChange={(event) => setLoggingOverride(event.target.checked)}
                  />
                }
                label="Override master settings"
              />
            )}
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={logging?.enabled ?? false} disabled={isSlave && !loggingOverride} />}
              label="Enable access logging"
            />
            <TextField
              name="format"
              label="Log Format"
              select
              defaultValue={logging?.format ?? "json"}
              helperText="Format for access logs"
              disabled={isSlave && !loggingOverride}
              fullWidth
            >
              <MenuItem value="json">JSON</MenuItem>
              <MenuItem value="console">Console (Common Log Format)</MenuItem>
            </TextField>
            <Alert severity="info">
              Access logs are stored in the caddy-logs Docker volume.
              You can view them with: docker exec caddy-proxy-manager-caddy tail -f /logs/access.log
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save logging settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Global Geoblocking
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Configure default geoblocking rules applied to all proxy hosts. Per-host rules can merge with or override these global defaults.
          </Typography>
          <Stack component="form" action={geoBlockFormAction} spacing={2}>
            {geoBlockState?.message && (
              <Alert severity={geoBlockState.success ? "success" : "error"}>
                {geoBlockState.message}
              </Alert>
            )}
            <GeoBlockFields
              initialValues={{ geoblock: globalGeoBlock ?? null, geoblock_mode: "merge" }}
              showModeSelector={false}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save geoblocking settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
