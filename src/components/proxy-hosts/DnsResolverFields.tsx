import { Box, Collapse, Stack, Switch, TextField, Typography, Alert } from "@mui/material";
import { useState } from "react";
import { ProxyHost } from "@/src/lib/models/proxy-hosts";

export function DnsResolverFields({
  dnsResolver
}: {
  dnsResolver?: ProxyHost["dns_resolver"] | null;
}) {
  const initial = dnsResolver ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "warning.main",
        bgcolor: "rgba(237, 108, 2, 0.05)",
        p: 2.5
      }}
    >
      <input type="hidden" name="dns_present" value="1" />
      <input type="hidden" name="dns_enabled_present" value="1" />
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Custom DNS Resolvers
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Configure per-host DNS resolution for upstream discovery and health checks
            </Typography>
          </Box>
          <Switch
            name="dns_enabled"
            checked={enabled}
            onChange={(_, checked) => setEnabled(checked)}
          />
        </Stack>

        <Collapse in={enabled} timeout="auto" unmountOnExit>
          <Stack spacing={2.5}>
            <TextField
              name="dns_resolvers"
              label="DNS Resolvers"
              placeholder={"1.1.1.1\n8.8.8.8"}
              defaultValue={initial?.resolvers?.join("\n") ?? ""}
              helperText="One resolver per line (e.g., 1.1.1.1, 8.8.8.8). Used for dynamic upstream DNS resolution."
              multiline
              minRows={2}
              fullWidth
              size="small"
            />
            <TextField
              name="dns_fallbacks"
              label="Fallback DNS Resolvers (Optional)"
              placeholder={"8.8.4.4\n1.0.0.1"}
              defaultValue={initial?.fallbacks?.join("\n") ?? ""}
              helperText="Fallback resolvers if primary fails. One per line."
              multiline
              minRows={2}
              fullWidth
              size="small"
            />
            <TextField
              name="dns_timeout"
              label="DNS Query Timeout"
              placeholder="5s"
              defaultValue={initial?.timeout ?? ""}
              helperText="Timeout for DNS queries (e.g., 5s, 10s)"
              fullWidth
              size="small"
            />
            <Alert severity="info">
              Per-host DNS resolvers override global settings for this specific proxy host.
              Useful for upstream services that require specific DNS resolution (e.g., internal DNS, service discovery).
              Common resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
            </Alert>
          </Stack>
        </Collapse>
      </Stack>
    </Box>
  );
}
