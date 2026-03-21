import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useFormState } from "react-dom";
import { useEffect, useState } from "react";
import {
  createL4ProxyHostAction,
  deleteL4ProxyHostAction,
  updateL4ProxyHostAction,
} from "@/app/(dashboard)/l4-proxy-hosts/actions";
import { INITIAL_ACTION_STATE } from "@/src/lib/actions";
import type { L4ProxyHost } from "@/src/lib/models/l4-proxy-hosts";
import { AppDialog } from "@/src/components/ui/AppDialog";

function L4HostForm({
  formId,
  formAction,
  state,
  initialData,
}: {
  formId: string;
  formAction: (formData: FormData) => void;
  state: { status: string; message?: string };
  initialData?: L4ProxyHost | null;
}) {
  const [protocol, setProtocol] = useState(initialData?.protocol ?? "tcp");
  const [matcherType, setMatcherType] = useState(initialData?.matcher_type ?? "none");

  return (
    <Stack component="form" id={formId} action={formAction} spacing={2.5}>
      {state.status !== "idle" && state.message && (
        <Alert severity={state.status === "error" ? "error" : "success"}>
          {state.message}
        </Alert>
      )}

      <input type="hidden" name="enabled_present" value="1" />
      <FormControlLabel
        control={
          <Switch
            name="enabled"
            defaultChecked={initialData?.enabled ?? true}
            color="success"
          />
        }
        label="Enabled"
      />

      <TextField
        name="name"
        label="Name"
        placeholder="PostgreSQL Proxy"
        defaultValue={initialData?.name ?? ""}
        required
        fullWidth
      />

      <TextField
        select
        name="protocol"
        label="Protocol"
        value={protocol}
        onChange={(e) => setProtocol(e.target.value as "tcp" | "udp")}
        fullWidth
      >
        <MenuItem value="tcp">TCP</MenuItem>
        <MenuItem value="udp">UDP</MenuItem>
      </TextField>

      <TextField
        name="listen_address"
        label="Listen Address"
        placeholder=":5432"
        defaultValue={initialData?.listen_address ?? ""}
        helperText="Format: :PORT or HOST:PORT. Make sure to expose this port in docker-compose.yml on the caddy service."
        required
        fullWidth
      />

      <TextField
        name="upstreams"
        label="Upstreams"
        placeholder={"10.0.0.1:5432\n10.0.0.2:5432"}
        defaultValue={initialData?.upstreams.join("\n") ?? ""}
        helperText="One per line in host:port format."
        multiline
        minRows={2}
        required
        fullWidth
      />

      <TextField
        select
        name="matcher_type"
        label="Matcher"
        value={matcherType}
        onChange={(e) => setMatcherType(e.target.value as "none" | "tls_sni" | "http_host" | "proxy_protocol")}
        helperText="Match incoming connections before proxying. 'None' matches all connections on this port."
        fullWidth
      >
        <MenuItem value="none">None (catch-all)</MenuItem>
        <MenuItem value="tls_sni">TLS SNI</MenuItem>
        <MenuItem value="http_host">HTTP Host</MenuItem>
        <MenuItem value="proxy_protocol">Proxy Protocol</MenuItem>
      </TextField>

      {(matcherType === "tls_sni" || matcherType === "http_host") && (
        <TextField
          name="matcher_value"
          label={matcherType === "tls_sni" ? "SNI Hostnames" : "HTTP Hostnames"}
          placeholder="db.example.com, api.example.com"
          defaultValue={initialData?.matcher_value?.join(", ") ?? ""}
          helperText="Comma-separated list of hostnames to match."
          required
          fullWidth
        />
      )}

      {protocol === "tcp" && (
        <FormControlLabel
          control={
            <Switch
              name="tls_termination"
              defaultChecked={initialData?.tls_termination ?? false}
            />
          }
          label="TLS Termination"
          sx={{ ml: 0 }}
        />
      )}

      <FormControlLabel
        control={
          <Switch
            name="proxy_protocol_receive"
            defaultChecked={initialData?.proxy_protocol_receive ?? false}
          />
        }
        label="Accept inbound PROXY protocol"
        sx={{ ml: 0 }}
      />

      <TextField
        select
        name="proxy_protocol_version"
        label="Send PROXY protocol to upstream"
        defaultValue={initialData?.proxy_protocol_version ?? ""}
        fullWidth
      >
        <MenuItem value="">None</MenuItem>
        <MenuItem value="v1">v1</MenuItem>
        <MenuItem value="v2">v2</MenuItem>
      </TextField>

      {/* Load Balancer */}
      <Accordion variant="outlined" defaultExpanded={!!initialData?.load_balancer?.enabled}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Load Balancer</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <input type="hidden" name="lb_present" value="1" />
            <input type="hidden" name="lb_enabled_present" value="1" />
            <FormControlLabel
              control={<Switch name="lb_enabled" defaultChecked={initialData?.load_balancer?.enabled ?? false} />}
              label="Enable Load Balancing"
            />
            <TextField
              select
              name="lb_policy"
              label="Policy"
              defaultValue={initialData?.load_balancer?.policy ?? "random"}
              fullWidth
              size="small"
            >
              <MenuItem value="random">Random</MenuItem>
              <MenuItem value="round_robin">Round Robin</MenuItem>
              <MenuItem value="least_conn">Least Connections</MenuItem>
              <MenuItem value="ip_hash">IP Hash</MenuItem>
              <MenuItem value="first">First Available</MenuItem>
            </TextField>
            <TextField name="lb_try_duration" label="Try Duration" placeholder="5s" defaultValue={initialData?.load_balancer?.tryDuration ?? ""} size="small" fullWidth />
            <TextField name="lb_try_interval" label="Try Interval" placeholder="250ms" defaultValue={initialData?.load_balancer?.tryInterval ?? ""} size="small" fullWidth />
            <TextField name="lb_retries" label="Retries" type="number" defaultValue={initialData?.load_balancer?.retries ?? ""} size="small" fullWidth />

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>Active Health Check</Typography>
            <input type="hidden" name="lb_active_health_enabled_present" value="1" />
            <FormControlLabel
              control={<Switch name="lb_active_health_enabled" defaultChecked={initialData?.load_balancer?.activeHealthCheck?.enabled ?? false} size="small" />}
              label="Enable Active Health Check"
            />
            <TextField name="lb_active_health_port" label="Health Check Port" type="number" defaultValue={initialData?.load_balancer?.activeHealthCheck?.port ?? ""} size="small" fullWidth />
            <TextField name="lb_active_health_interval" label="Interval" placeholder="30s" defaultValue={initialData?.load_balancer?.activeHealthCheck?.interval ?? ""} size="small" fullWidth />
            <TextField name="lb_active_health_timeout" label="Timeout" placeholder="5s" defaultValue={initialData?.load_balancer?.activeHealthCheck?.timeout ?? ""} size="small" fullWidth />

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>Passive Health Check</Typography>
            <input type="hidden" name="lb_passive_health_enabled_present" value="1" />
            <FormControlLabel
              control={<Switch name="lb_passive_health_enabled" defaultChecked={initialData?.load_balancer?.passiveHealthCheck?.enabled ?? false} size="small" />}
              label="Enable Passive Health Check"
            />
            <TextField name="lb_passive_health_fail_duration" label="Fail Duration" placeholder="30s" defaultValue={initialData?.load_balancer?.passiveHealthCheck?.failDuration ?? ""} size="small" fullWidth />
            <TextField name="lb_passive_health_max_fails" label="Max Fails" type="number" defaultValue={initialData?.load_balancer?.passiveHealthCheck?.maxFails ?? ""} size="small" fullWidth />
            <TextField name="lb_passive_health_unhealthy_latency" label="Unhealthy Latency" placeholder="5s" defaultValue={initialData?.load_balancer?.passiveHealthCheck?.unhealthyLatency ?? ""} size="small" fullWidth />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* DNS Resolver */}
      <Accordion variant="outlined" defaultExpanded={!!initialData?.dns_resolver?.enabled}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Custom DNS Resolvers</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <input type="hidden" name="dns_present" value="1" />
            <input type="hidden" name="dns_enabled_present" value="1" />
            <FormControlLabel
              control={<Switch name="dns_enabled" defaultChecked={initialData?.dns_resolver?.enabled ?? false} />}
              label="Enable Custom DNS"
            />
            <TextField
              name="dns_resolvers"
              label="DNS Resolvers"
              placeholder={"1.1.1.1\n8.8.8.8"}
              defaultValue={initialData?.dns_resolver?.resolvers?.join("\n") ?? ""}
              helperText="One per line. Used for upstream hostname resolution."
              multiline
              minRows={2}
              size="small"
              fullWidth
            />
            <TextField
              name="dns_fallbacks"
              label="Fallback Resolvers"
              placeholder="8.8.4.4"
              defaultValue={initialData?.dns_resolver?.fallbacks?.join("\n") ?? ""}
              helperText="Fallback DNS servers (one per line)."
              multiline
              minRows={1}
              size="small"
              fullWidth
            />
            <TextField name="dns_timeout" label="Timeout" placeholder="5s" defaultValue={initialData?.dns_resolver?.timeout ?? ""} size="small" fullWidth />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Geo Blocking */}
      <Accordion variant="outlined" defaultExpanded={!!initialData?.geoblock?.enabled}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Geo Blocking</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <input type="hidden" name="geoblock_present" value="1" />
            <FormControlLabel
              control={<Switch name="geoblock_enabled" defaultChecked={initialData?.geoblock?.enabled ?? false} />}
              label="Enable Geo Blocking"
            />
            <TextField
              select
              name="geoblock_mode"
              label="Mode"
              defaultValue={initialData?.geoblock_mode ?? "merge"}
              size="small"
              fullWidth
            >
              <MenuItem value="merge">Merge with global settings</MenuItem>
              <MenuItem value="override">Override global settings</MenuItem>
            </TextField>
            <Typography variant="caption" color="text.secondary">Block Rules</Typography>
            <TextField name="geoblock_block_countries" label="Block Countries" placeholder="CN, RU, KP" defaultValue={initialData?.geoblock?.block_countries?.join(", ") ?? ""} helperText="ISO 3166-1 alpha-2 codes, comma-separated" size="small" fullWidth />
            <TextField name="geoblock_block_continents" label="Block Continents" placeholder="AF, AS" defaultValue={initialData?.geoblock?.block_continents?.join(", ") ?? ""} helperText="AF, AN, AS, EU, NA, OC, SA" size="small" fullWidth />
            <TextField name="geoblock_block_asns" label="Block ASNs" placeholder="12345, 67890" defaultValue={initialData?.geoblock?.block_asns?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_block_cidrs" label="Block CIDRs" placeholder="192.0.2.0/24" defaultValue={initialData?.geoblock?.block_cidrs?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_block_ips" label="Block IPs" placeholder="203.0.113.1" defaultValue={initialData?.geoblock?.block_ips?.join(", ") ?? ""} size="small" fullWidth />
            <Typography variant="caption" color="text.secondary">Allow Rules (override blocks)</Typography>
            <TextField name="geoblock_allow_countries" label="Allow Countries" placeholder="US, DE" defaultValue={initialData?.geoblock?.allow_countries?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_allow_continents" label="Allow Continents" placeholder="EU, NA" defaultValue={initialData?.geoblock?.allow_continents?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_allow_asns" label="Allow ASNs" placeholder="11111" defaultValue={initialData?.geoblock?.allow_asns?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_allow_cidrs" label="Allow CIDRs" placeholder="10.0.0.0/8" defaultValue={initialData?.geoblock?.allow_cidrs?.join(", ") ?? ""} size="small" fullWidth />
            <TextField name="geoblock_allow_ips" label="Allow IPs" placeholder="1.2.3.4" defaultValue={initialData?.geoblock?.allow_ips?.join(", ") ?? ""} size="small" fullWidth />
            <Alert severity="info" sx={{ mt: 1 }}>
              At L4, geo blocking uses the client&apos;s direct IP address (no X-Forwarded-For support). Blocked connections are immediately closed.
            </Alert>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Upstream DNS Resolution / Pinning */}
      <Accordion variant="outlined" defaultExpanded={initialData?.upstream_dns_resolution?.enabled === true}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Upstream DNS Pinning</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <input type="hidden" name="upstream_dns_resolution_present" value="1" />
            <Typography variant="body2" color="text.secondary">
              When enabled, upstream hostnames are resolved to IP addresses at config time, pinning DNS resolution.
            </Typography>
            <TextField
              select
              name="upstream_dns_resolution_mode"
              label="Resolution Mode"
              defaultValue={initialData?.upstream_dns_resolution?.enabled === true ? "enabled" : initialData?.upstream_dns_resolution?.enabled === false ? "disabled" : "inherit"}
              size="small"
              fullWidth
            >
              <MenuItem value="inherit">Inherit from global settings</MenuItem>
              <MenuItem value="enabled">Enabled</MenuItem>
              <MenuItem value="disabled">Disabled</MenuItem>
            </TextField>
            <TextField
              select
              name="upstream_dns_resolution_family"
              label="Address Family Preference"
              defaultValue={initialData?.upstream_dns_resolution?.family ?? "inherit"}
              size="small"
              fullWidth
            >
              <MenuItem value="inherit">Inherit from global settings</MenuItem>
              <MenuItem value="both">Both (IPv6 + IPv4)</MenuItem>
              <MenuItem value="ipv6">IPv6 only</MenuItem>
              <MenuItem value="ipv4">IPv4 only</MenuItem>
            </TextField>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}

export function CreateL4HostDialog({
  open,
  onClose,
  initialData,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: L4ProxyHost | null;
}) {
  const [state, formAction] = useFormState(createL4ProxyHostAction, INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={initialData ? "Duplicate L4 Proxy Host" : "Create L4 Proxy Host"}
      maxWidth="sm"
      submitLabel="Create"
      onSubmit={() => {
        (document.getElementById("create-l4-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="create-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={initialData ? { ...initialData, name: `${initialData.name} (Copy)` } : null}
      />
    </AppDialog>
  );
}

export function EditL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState(updateL4ProxyHostAction.bind(null, host.id), INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Edit L4 Proxy Host"
      maxWidth="sm"
      submitLabel="Save Changes"
      onSubmit={() => {
        (document.getElementById("edit-l4-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="edit-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={host}
      />
    </AppDialog>
  );
}

export function DeleteL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState(deleteL4ProxyHostAction.bind(null, host.id), INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete L4 Proxy Host"
      maxWidth="sm"
      submitLabel="Delete"
      onSubmit={() => {
        (document.getElementById("delete-l4-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <Stack component="form" id="delete-l4-host-form" action={formAction} spacing={2}>
        {state.status !== "idle" && state.message && (
          <Alert severity={state.status === "error" ? "error" : "success"}>
            {state.message}
          </Alert>
        )}
        <Typography variant="body1">
          Are you sure you want to delete the L4 proxy host <strong>{host.name}</strong>?
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This will remove the configuration for:
        </Typography>
        <Box sx={{ pl: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {"\u2022"} Protocol: {host.protocol.toUpperCase()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {"\u2022"} Listen: {host.listen_address}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {"\u2022"} Upstreams: {host.upstreams.join(", ")}
          </Typography>
        </Box>
        <Typography variant="body2" color="error.main" fontWeight={500}>
          This action cannot be undone.
        </Typography>
      </Stack>
    </AppDialog>
  );
}
