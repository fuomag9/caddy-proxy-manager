import { Alert, Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { ProxyHost } from "@/src/lib/models/proxy-hosts";

type ResolutionMode = "inherit" | "enabled" | "disabled";
type FamilyMode = "inherit" | "ipv6" | "ipv4" | "both";

function toResolutionMode(enabled: boolean | null | undefined): ResolutionMode {
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "inherit";
}

function toFamilyMode(family: "ipv6" | "ipv4" | "both" | null | undefined): FamilyMode {
  if (family === "ipv6" || family === "ipv4" || family === "both") {
    return family;
  }
  return "inherit";
}

export function UpstreamDnsResolutionFields({
  upstreamDnsResolution
}: {
  upstreamDnsResolution?: ProxyHost["upstream_dns_resolution"] | null;
}) {
  const mode = toResolutionMode(upstreamDnsResolution?.enabled);
  const family = toFamilyMode(upstreamDnsResolution?.family);

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "info.main",
        bgcolor: "rgba(2, 136, 209, 0.06)",
        p: 2.5
      }}
    >
      <input type="hidden" name="upstream_dns_resolution_present" value="1" />
      <Stack spacing={2}>
        <Typography variant="subtitle1" fontWeight={600}>
          Upstream DNS Pinning
        </Typography>
        <TextField
          name="upstream_dns_resolution_mode"
          label="Resolution Mode"
          select
          defaultValue={mode}
          helperText="Inherit uses the global setting. Enabled/Disabled overrides per host."
          size="small"
          fullWidth
        >
          <MenuItem value="inherit">Inherit Global</MenuItem>
          <MenuItem value="enabled">Enabled</MenuItem>
          <MenuItem value="disabled">Disabled</MenuItem>
        </TextField>
        <TextField
          name="upstream_dns_resolution_family"
          label="Address Family Preference"
          select
          defaultValue={family}
          helperText="Both resolves AAAA + A with IPv6 preferred ordering."
          size="small"
          fullWidth
        >
          <MenuItem value="inherit">Inherit Global</MenuItem>
          <MenuItem value="both">Both (Prefer IPv6)</MenuItem>
          <MenuItem value="ipv6">IPv6 only</MenuItem>
          <MenuItem value="ipv4">IPv4 only</MenuItem>
        </TextField>
        <Alert severity="info">
          When enabled, hostname upstreams are resolved during config apply and written to Caddy as concrete IP dials. If this handler has
          multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those HTTPS upstreams to avoid SNI mismatch.
        </Alert>
      </Stack>
    </Box>
  );
}
