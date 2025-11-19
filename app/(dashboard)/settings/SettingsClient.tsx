"use client";

import { useFormState } from "react-dom";
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { GeneralSettings, AuthentikSettings, MetricsSettings, LoggingSettings } from "@/src/lib/settings";
import {
  updateCloudflareSettingsAction,
  updateGeneralSettingsAction,
  updateAuthentikSettingsAction,
  updateMetricsSettingsAction,
  updateLoggingSettingsAction
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
};

export default function SettingsClient({ general, cloudflare, authentik, metrics, logging }: Props) {
  const [generalState, generalFormAction] = useFormState(updateGeneralSettingsAction, null);
  const [cloudflareState, cloudflareFormAction] = useFormState(updateCloudflareSettingsAction, null);
  const [authentikState, authentikFormAction] = useFormState(updateAuthentikSettingsAction, null);
  const [metricsState, metricsFormAction] = useFormState(updateMetricsSettingsAction, null);
  const [loggingState, loggingFormAction] = useFormState(updateLoggingSettingsAction, null);

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
            General
          </Typography>
          <Stack component="form" action={generalFormAction} spacing={2}>
            {generalState?.message && (
              <Alert severity={generalState.success ? "success" : "error"}>
                {generalState.message}
              </Alert>
            )}
            <TextField
              name="primaryDomain"
              label="Primary domain"
              defaultValue={general?.primaryDomain ?? "caddyproxymanager.com"}
              required
              fullWidth
            />
            <TextField
              name="acmeEmail"
              label="ACME contact email"
              type="email"
              defaultValue={general?.acmeEmail ?? ""}
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
            <TextField
              name="apiToken"
              label="API token"
              type="password"
              autoComplete="new-password"
              placeholder="Enter new token"
              fullWidth
            />
            <FormControlLabel
              control={<Checkbox name="clearToken" />}
              label="Remove existing token"
              disabled={!cloudflare.hasToken}
            />
            <TextField name="zoneId" label="Zone ID" defaultValue={cloudflare.zoneId ?? ""} fullWidth />
            <TextField name="accountId" label="Account ID" defaultValue={cloudflare.accountId ?? ""} fullWidth />
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
            <TextField
              name="outpostDomain"
              label="Outpost Domain"
              placeholder="outpost.goauthentik.io"
              defaultValue={authentik?.outpostDomain ?? ""}
              helperText="Authentik outpost domain"
              required
              fullWidth
            />
            <TextField
              name="outpostUpstream"
              label="Outpost Upstream"
              placeholder="http://authentik-server:9000"
              defaultValue={authentik?.outpostUpstream ?? ""}
              helperText="Internal URL of Authentik outpost"
              required
              fullWidth
            />
            <TextField
              name="authEndpoint"
              label="Authpost Endpoint"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              defaultValue={authentik?.authEndpoint ?? ""}
              helperText="Authpost endpoint path"
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
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={metrics?.enabled ?? false} />}
              label="Enable metrics endpoint"
            />
            <TextField
              name="port"
              label="Metrics Port"
              type="number"
              defaultValue={metrics?.port ?? 9090}
              helperText="Port to expose metrics on (default: 9090, separate from admin API on 2019)"
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
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={logging?.enabled ?? false} />}
              label="Enable access logging"
            />
            <TextField
              name="format"
              label="Log Format"
              select
              defaultValue={logging?.format ?? "json"}
              helperText="Format for access logs"
              fullWidth
            >
              <MenuItem value="json">JSON</MenuItem>
              <MenuItem value="console">Console (Common Log Format)</MenuItem>
            </TextField>
            <Alert severity="info">
              Access logs will be available at ./caddy-logs/access.log on the host machine.
              You can tail them with: docker exec caddy-proxy-manager-caddy tail -f /logs/access.log
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="contained">
                Save logging settings
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
