"use client";

import { useFormState } from "react-dom";
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import type { GeneralSettings, AuthentikSettings, LoggingSettings, MetricsSettings } from "@/src/lib/settings";
import {
  updateCloudflareSettingsAction,
  updateGeneralSettingsAction,
  updateAuthentikSettingsAction,
  updateLoggingSettingsAction,
  updateMetricsSettingsAction
} from "./actions";

type Props = {
  general: GeneralSettings | null;
  cloudflare: {
    hasToken: boolean;
    zoneId?: string;
    accountId?: string;
  };
  authentik: AuthentikSettings | null;
  logging: {
    enabled: boolean;
    lokiUrl?: string;
    lokiUsername?: string;
    hasPassword: boolean;
    labels?: Record<string, string>;
  } | null;
  metrics: MetricsSettings | null;
};

export default function SettingsClient({ general, cloudflare, authentik, logging, metrics }: Props) {
  const [generalState, generalFormAction] = useFormState(updateGeneralSettingsAction, null);
  const [cloudflareState, cloudflareFormAction] = useFormState(updateCloudflareSettingsAction, null);
  const [authentikState, authentikFormAction] = useFormState(updateAuthentikSettingsAction, null);
  const [loggingState, loggingFormAction] = useFormState(updateLoggingSettingsAction, null);
  const [metricsState, metricsFormAction] = useFormState(updateMetricsSettingsAction, null);

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
              placeholder="auth.example.com"
              defaultValue={authentik?.outpostDomain ?? ""}
              helperText="Domain where Authentik is hosted"
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
              label="Auth Endpoint (Optional)"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              defaultValue={authentik?.authEndpoint ?? ""}
              helperText="Custom authentication endpoint path"
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
            Logging
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Enable comprehensive request logging to Loki for debugging and monitoring.
            You must deploy your own Loki instance and provide its URL.
          </Typography>
          {logging?.hasPassword && (
            <Alert severity="info" sx={{ mb: 2 }}>
              A Loki password is already configured. Leave the password field blank to keep it, or enter a new password to update it.
            </Alert>
          )}
          <Stack component="form" action={loggingFormAction} spacing={2}>
            {loggingState?.message && (
              <Alert severity={loggingState.success ? "success" : "error"}>
                {loggingState.message}
              </Alert>
            )}
            <FormControlLabel
              control={<Checkbox name="enabled" defaultChecked={logging?.enabled ?? false} />}
              label="Enable request logging"
            />
            <TextField
              name="lokiUrl"
              label="Loki URL"
              defaultValue={logging?.lokiUrl ?? ""}
              placeholder="http://loki:3100"
              helperText="URL of your Loki instance (e.g., http://loki:3100 or https://loki.example.com)"
              fullWidth
            />
            <TextField
              name="lokiUsername"
              label="Loki Username (optional)"
              defaultValue={logging?.lokiUsername ?? ""}
              helperText="Leave empty if your Loki instance doesn't require authentication"
              fullWidth
            />
            <TextField
              name="lokiPassword"
              label="Loki Password (optional)"
              type="password"
              autoComplete="new-password"
              placeholder={logging?.hasPassword ? "Enter new password to update" : "Enter password"}
              helperText="Leave empty to keep existing password, or enter new password to update"
              fullWidth
            />
            <FormControlLabel
              control={<Checkbox name="clearPassword" />}
              label="Remove existing password"
              disabled={!logging?.hasPassword}
            />
            <TextField
              name="labels"
              label="Custom Labels (optional)"
              defaultValue={logging?.labels ? JSON.stringify(logging.labels) : ""}
              placeholder='{"environment":"production","service":"caddy"}'
              helperText="Optional JSON object of custom labels to add to logs"
              fullWidth
              multiline
              rows={2}
            />
            <Alert severity="info">
              After enabling logging, all Caddy requests will be sent to your Loki instance.
              You can query and visualize logs in Grafana using the Loki datasource.
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
    </Stack>
  );
}
