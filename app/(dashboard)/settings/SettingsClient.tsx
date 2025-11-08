"use client";

import { useFormState } from "react-dom";
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import type { GeneralSettings, AuthentikSettings } from "@/src/lib/settings";
import {
  updateCloudflareSettingsAction,
  updateGeneralSettingsAction,
  updateAuthentikSettingsAction
} from "./actions";

type Props = {
  general: GeneralSettings | null;
  cloudflare: {
    hasToken: boolean;
    zoneId?: string;
    accountId?: string;
  };
  authentik: AuthentikSettings | null;
};

export default function SettingsClient({ general, cloudflare, authentik }: Props) {
  const [generalState, generalFormAction] = useFormState(updateGeneralSettingsAction, null);
  const [cloudflareState, cloudflareFormAction] = useFormState(updateCloudflareSettingsAction, null);
  const [authentikState, authentikFormAction] = useFormState(updateAuthentikSettingsAction, null);

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
    </Stack>
  );
}
