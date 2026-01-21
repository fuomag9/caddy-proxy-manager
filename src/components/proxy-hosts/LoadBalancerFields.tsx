
import { Box, Collapse, FormControlLabel, Stack, Switch, TextField, Typography, MenuItem } from "@mui/material";
import { useState } from "react";
import { ProxyHost, LoadBalancingPolicy } from "@/src/lib/models/proxy-hosts";

const LOAD_BALANCING_POLICIES = [
  { value: "random", label: "Random", description: "Random selection (default)" },
  { value: "round_robin", label: "Round Robin", description: "Sequential distribution" },
  { value: "least_conn", label: "Least Connections", description: "Fewest active connections" },
  { value: "ip_hash", label: "IP Hash", description: "Client IP-based sticky sessions" },
  { value: "first", label: "First Available", description: "First available upstream" },
  { value: "header", label: "Header Hash", description: "Hash based on request header" },
  { value: "cookie", label: "Cookie", description: "Cookie-based sticky sessions" },
  { value: "uri_hash", label: "URI Hash", description: "URI path-based distribution" }
];

export function LoadBalancerFields({
  loadBalancer
}: {
  loadBalancer?: ProxyHost["load_balancer"] | null;
}) {
  const initial = loadBalancer ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [policy, setPolicy] = useState<LoadBalancingPolicy>(initial?.policy ?? "random");
  const [activeHealthEnabled, setActiveHealthEnabled] = useState(initial?.activeHealthCheck?.enabled ?? false);
  const [passiveHealthEnabled, setPassiveHealthEnabled] = useState(initial?.passiveHealthCheck?.enabled ?? false);

  const showHeaderField = policy === "header";
  const showCookieFields = policy === "cookie";

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "info.main",
        bgcolor: "rgba(2, 136, 209, 0.05)",
        p: 2.5
      }}
    >
      <input type="hidden" name="lb_present" value="1" />
      <input type="hidden" name="lb_enabled_present" value="1" />
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Load Balancer
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Configure load balancing and health checks for multiple upstreams
            </Typography>
          </Box>
          <Switch
            name="lb_enabled"
            checked={enabled}
            onChange={(_, checked) => setEnabled(checked)}
          />
        </Stack>

        <Collapse in={enabled} timeout="auto" unmountOnExit>
          <Stack spacing={2.5}>
            {/* Policy Selection */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Selection Policy
              </Typography>
              <TextField
                select
                name="lb_policy"
                label="Load Balancing Policy"
                value={policy}
                onChange={(e) => setPolicy(e.target.value as LoadBalancingPolicy)}
                fullWidth
                size="small"
              >
                {LOAD_BALANCING_POLICIES.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label} - {p.description}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            {/* Header-based policy fields */}
            <Collapse in={showHeaderField} timeout="auto" unmountOnExit>
              <TextField
                name="lb_policy_header_field"
                label="Header Field Name"
                placeholder="X-Custom-Header"
                defaultValue={initial?.policyHeaderField ?? ""}
                helperText="The request header to hash for upstream selection"
                fullWidth
                size="small"
              />
            </Collapse>

            {/* Cookie-based policy fields */}
            <Collapse in={showCookieFields} timeout="auto" unmountOnExit>
              <Stack spacing={2}>
                <TextField
                  name="lb_policy_cookie_name"
                  label="Cookie Name"
                  placeholder="server_id"
                  defaultValue={initial?.policyCookieName ?? ""}
                  helperText="Name of the cookie for sticky sessions"
                  fullWidth
                  size="small"
                />
                <TextField
                  name="lb_policy_cookie_secret"
                  label="Cookie Secret (Optional)"
                  placeholder="your-secret-key"
                  defaultValue={initial?.policyCookieSecret ?? ""}
                  helperText="Secret key for HMAC cookie signing"
                  fullWidth
                  size="small"
                />
              </Stack>
            </Collapse>

            {/* Retry Settings */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Retry Settings
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="lb_try_duration"
                  label="Try Duration"
                  placeholder="5s"
                  defaultValue={initial?.tryDuration ?? ""}
                  helperText="How long to try upstreams"
                  fullWidth
                  size="small"
                />
                <TextField
                  name="lb_try_interval"
                  label="Try Interval"
                  placeholder="250ms"
                  defaultValue={initial?.tryInterval ?? ""}
                  helperText="Wait between attempts"
                  fullWidth
                  size="small"
                />
                <TextField
                  name="lb_retries"
                  label="Max Retries"
                  type="number"
                  inputProps={{ min: 0 }}
                  defaultValue={initial?.retries ?? ""}
                  helperText="Maximum retry attempts"
                  fullWidth
                  size="small"
                />
              </Stack>
            </Box>

            {/* Active Health Checks */}
            <Box
              sx={{
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                p: 2
              }}
            >
              <input type="hidden" name="lb_active_health_enabled_present" value="1" />
              <Stack spacing={2}>
                <FormControlLabel
                  control={
                    <Switch
                      name="lb_active_health_enabled"
                      checked={activeHealthEnabled}
                      onChange={(_, checked) => setActiveHealthEnabled(checked)}
                      size="small"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="subtitle2">Active Health Checks</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Periodically probe upstreams to check health
                      </Typography>
                    </Box>
                  }
                />

                <Collapse in={activeHealthEnabled} timeout="auto" unmountOnExit>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        name="lb_active_health_uri"
                        label="Health Check URI"
                        placeholder="/health"
                        defaultValue={initial?.activeHealthCheck?.uri ?? ""}
                        helperText="Path to probe for health"
                        fullWidth
                        size="small"
                      />
                      <TextField
                        name="lb_active_health_port"
                        label="Health Check Port"
                        type="number"
                        inputProps={{ min: 1, max: 65535 }}
                        defaultValue={initial?.activeHealthCheck?.port ?? ""}
                        helperText="Override upstream port"
                        fullWidth
                        size="small"
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        name="lb_active_health_interval"
                        label="Check Interval"
                        placeholder="30s"
                        defaultValue={initial?.activeHealthCheck?.interval ?? ""}
                        helperText="How often to check"
                        fullWidth
                        size="small"
                      />
                      <TextField
                        name="lb_active_health_timeout"
                        label="Check Timeout"
                        placeholder="5s"
                        defaultValue={initial?.activeHealthCheck?.timeout ?? ""}
                        helperText="Timeout for health probe"
                        fullWidth
                        size="small"
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        name="lb_active_health_status"
                        label="Expected Status Code"
                        type="number"
                        inputProps={{ min: 100, max: 599 }}
                        defaultValue={initial?.activeHealthCheck?.status ?? ""}
                        helperText="Expected HTTP status"
                        fullWidth
                        size="small"
                      />
                      <TextField
                        name="lb_active_health_body"
                        label="Expected Body"
                        placeholder="OK"
                        defaultValue={initial?.activeHealthCheck?.body ?? ""}
                        helperText="Expected response body"
                        fullWidth
                        size="small"
                      />
                    </Stack>
                  </Stack>
                </Collapse>
              </Stack>
            </Box>

            {/* Passive Health Checks */}
            <Box
              sx={{
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                p: 2
              }}
            >
              <input type="hidden" name="lb_passive_health_enabled_present" value="1" />
              <Stack spacing={2}>
                <FormControlLabel
                  control={
                    <Switch
                      name="lb_passive_health_enabled"
                      checked={passiveHealthEnabled}
                      onChange={(_, checked) => setPassiveHealthEnabled(checked)}
                      size="small"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="subtitle2">Passive Health Checks</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Mark upstreams unhealthy based on response failures
                      </Typography>
                    </Box>
                  }
                />

                <Collapse in={passiveHealthEnabled} timeout="auto" unmountOnExit>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        name="lb_passive_health_fail_duration"
                        label="Fail Duration"
                        placeholder="30s"
                        defaultValue={initial?.passiveHealthCheck?.failDuration ?? ""}
                        helperText="How long to remember failures"
                        fullWidth
                        size="small"
                      />
                      <TextField
                        name="lb_passive_health_max_fails"
                        label="Max Failures"
                        type="number"
                        inputProps={{ min: 0 }}
                        defaultValue={initial?.passiveHealthCheck?.maxFails ?? ""}
                        helperText="Failures before marking unhealthy"
                        fullWidth
                        size="small"
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        name="lb_passive_health_unhealthy_status"
                        label="Unhealthy Status Codes"
                        placeholder="500, 502, 503"
                        defaultValue={initial?.passiveHealthCheck?.unhealthyStatus?.join(", ") ?? ""}
                        helperText="Comma-separated status codes"
                        fullWidth
                        size="small"
                      />
                      <TextField
                        name="lb_passive_health_unhealthy_latency"
                        label="Unhealthy Latency"
                        placeholder="5s"
                        defaultValue={initial?.passiveHealthCheck?.unhealthyLatency ?? ""}
                        helperText="Latency threshold for unhealthy"
                        fullWidth
                        size="small"
                      />
                    </Stack>
                  </Stack>
                </Collapse>
              </Stack>
            </Box>
          </Stack>
        </Collapse>
      </Stack>
    </Box>
  );
}
