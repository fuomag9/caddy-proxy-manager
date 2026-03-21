import { Alert, Box, Chip, Collapse, Divider, MenuItem, Stack, Switch, TextField, Typography, FormControlLabel, Checkbox, Accordion, AccordionSummary, AccordionDetails, IconButton, Button } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { useActionState, useEffect, useState } from "react";
import {
  createL4RouteAction,
  deleteL4RouteAction,
  updateL4RouteAction,
} from "@/app/(dashboard)/l4-routes/actions";
import { INITIAL_ACTION_STATE } from "@/src/lib/actions";
import type { L4Route, L4Matcher, L4Upstream, L4HandlerType, L4LoadBalancingPolicy, L4RouteMeta, L4IpBlockOverride } from "@/src/lib/models/l4-routes";
import type { Certificate } from "@/src/lib/models/certificates";
import { AppDialog } from "@/src/components/ui/AppDialog";

const HANDLER_TYPES: { value: L4HandlerType; label: string }[] = [
  { value: "proxy", label: "Proxy" },
  { value: "echo", label: "Echo" },
  { value: "close", label: "Close" },
  { value: "socks5", label: "SOCKS5" },
];

const LB_POLICIES: { value: L4LoadBalancingPolicy; label: string }[] = [
  { value: "random", label: "Random" },
  { value: "round_robin", label: "Round Robin" },
  { value: "least_conn", label: "Least Connections" },
  { value: "ip_hash", label: "IP Hash" },
  { value: "first", label: "First Available" },
];

const MATCHER_TYPES = [
  { value: "tls", label: "TLS (SNI / ALPN)" },
  { value: "remote_ip", label: "Remote IP" },
  { value: "local_ip", label: "Local IP" },
  { value: "ssh", label: "SSH" },
  { value: "dns", label: "DNS" },
  { value: "http", label: "HTTP" },
  { value: "rdp", label: "RDP" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "openvpn", label: "OpenVPN" },
  { value: "socks4", label: "SOCKSv4" },
  { value: "socks5", label: "SOCKSv5" },
  { value: "xmpp", label: "XMPP" },
  { value: "wireguard", label: "WireGuard" },
  { value: "quic", label: "QUIC" },
  { value: "proxy_protocol", label: "Proxy Protocol" },
] as const;

type MatcherEntry = {
  type: string;
  sni?: string;
  alpn?: string;
  ranges?: string;
};

function matcherEntriesToJson(entries: MatcherEntry[]): L4Matcher[] | null {
  if (entries.length === 0) return null;
  const matchers: L4Matcher[] = [];
  for (const entry of entries) {
    if (entry.type === "tls") {
      const tls: Record<string, unknown> = {};
      if (entry.sni?.trim()) {
        tls.sni = entry.sni.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (entry.alpn?.trim()) {
        tls.alpn = entry.alpn.split(",").map((s) => s.trim()).filter(Boolean);
      }
      matchers.push({ tls } as L4Matcher);
    } else if (entry.type === "remote_ip" || entry.type === "local_ip") {
      const ranges = entry.ranges?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      if (ranges.length > 0) {
        matchers.push({ [entry.type]: { ranges } } as unknown as L4Matcher);
      }
    } else {
      // Protocol detection matchers (ssh, dns, http, rdp, etc.) — empty object
      matchers.push({ [entry.type]: {} } as unknown as L4Matcher);
    }
  }
  return matchers.length > 0 ? matchers : null;
}

function jsonToMatcherEntries(matchers: L4Matcher[] | null): MatcherEntry[] {
  if (!matchers) return [];
  return matchers.map((m) => {
    const obj = m as Record<string, unknown>;
    const type = Object.keys(obj)[0];
    if (!type) return { type: "tls" };
    if (type === "tls") {
      const tls = obj.tls as Record<string, unknown> | undefined;
      return {
        type: "tls",
        sni: (tls?.sni as string[])?.join(", ") ?? "",
        alpn: (tls?.alpn as string[])?.join(", ") ?? "",
      };
    }
    if (type === "remote_ip" || type === "local_ip") {
      const ip = obj[type] as { ranges?: string[] } | undefined;
      return { type, ranges: ip?.ranges?.join(", ") ?? "" };
    }
    return { type };
  });
}

type UpstreamEntry = {
  dial: string;
  tlsEnabled: boolean;
  tlsInsecureSkipVerify: boolean;
  tlsServerName: string;
};

function upstreamEntriesToJson(entries: UpstreamEntry[]): L4Upstream[] | null {
  const upstreams: L4Upstream[] = [];
  for (const entry of entries) {
    if (!entry.dial.trim()) continue;
    const upstream: L4Upstream = { dial: [entry.dial.trim()] };
    if (entry.tlsEnabled) {
      upstream.tls = {};
      if (entry.tlsInsecureSkipVerify) {
        upstream.tls.insecure_skip_verify = true;
      }
      if (entry.tlsServerName.trim()) {
        upstream.tls.server_name = entry.tlsServerName.trim();
      }
    }
    upstreams.push(upstream);
  }
  return upstreams.length > 0 ? upstreams : null;
}

function jsonToUpstreamEntries(upstreams: L4Upstream[] | null): UpstreamEntry[] {
  if (!upstreams || upstreams.length === 0) return [{ dial: "", tlsEnabled: false, tlsInsecureSkipVerify: false, tlsServerName: "" }];
  return upstreams.map((u) => ({
    dial: u.dial?.[0] ?? "",
    tlsEnabled: !!u.tls,
    tlsInsecureSkipVerify: u.tls?.insecure_skip_verify ?? false,
    tlsServerName: u.tls?.server_name ?? "",
  }));
}

// ── Shared Form ──

function L4RouteForm({
  formId,
  formAction,
  initialData,
  isEdit,
  certificates,
}: {
  formId: string;
  formAction: (payload: FormData) => void;
  initialData?: L4Route | null;
  isEdit?: boolean;
  certificates?: Certificate[];
}) {
  const [handlerType, setHandlerType] = useState<L4HandlerType>(initialData?.handler_type ?? "proxy");
  const [tlsTermination, setTlsTermination] = useState(initialData?.tls_termination ?? false);
  const [certificateId, setCertificateId] = useState<string>(initialData?.certificate_id?.toString() ?? "");
  const [listenAddrs, setListenAddrs] = useState(initialData?.listen_addresses.join("\n") ?? "");
  const [proxyProtocol, setProxyProtocol] = useState(initialData?.proxy_protocol ?? "");

  // Detect if any listen address uses UDP — proxy protocol is not compatible with UDP
  const hasUdp = listenAddrs.split("\n").some((a) => a.trim().toLowerCase().startsWith("udp/"));
  const ppDisabled = hasUdp || handlerType !== "proxy";
  const ppHelperText = hasUdp
    ? "Proxy Protocol is not compatible with UDP"
    : handlerType !== "proxy"
      ? "Proxy Protocol is only available for the proxy handler"
      : undefined;
  const [matcherEntries, setMatcherEntries] = useState<MatcherEntry[]>(() =>
    jsonToMatcherEntries(initialData?.matchers ?? null)
  );
  const [upstreamEntries, setUpstreamEntries] = useState<UpstreamEntry[]>(() =>
    jsonToUpstreamEntries(initialData?.upstreams ?? null)
  );

  // Meta state
  const [lbPolicy, setLbPolicy] = useState<string>(initialData?.meta?.load_balancing?.policy ?? "");
  const [hcInterval, setHcInterval] = useState(initialData?.meta?.health_check?.interval ?? "");
  const [hcTimeout, setHcTimeout] = useState(initialData?.meta?.health_check?.timeout ?? "");
  const [hcPort, setHcPort] = useState(initialData?.meta?.health_check?.port?.toString() ?? "");
  const [throttleRead, setThrottleRead] = useState(initialData?.meta?.throttle?.read_bytes_per_second?.toString() ?? "");
  const [throttleWrite, setThrottleWrite] = useState(initialData?.meta?.throttle?.write_bytes_per_second?.toString() ?? "");

  // IP Block state
  const [ipBlockEnabled, setIpBlockEnabled] = useState(initialData?.meta?.ip_block?.mode !== undefined && initialData?.meta?.ip_block?.mode !== "disabled");
  const [ipBlockMode, setIpBlockMode] = useState<"inherit" | "override">(initialData?.meta?.ip_block?.mode === "override" ? "override" : "inherit");
  const [blockCidrs, setBlockCidrs] = useState<string[]>(initialData?.meta?.ip_block?.block_cidrs ?? []);
  const [allowCidrs, setAllowCidrs] = useState<string[]>(initialData?.meta?.ip_block?.allow_cidrs ?? []);
  const [blockCidrInput, setBlockCidrInput] = useState("");
  const [allowCidrInput, setAllowCidrInput] = useState("");

  const addMatcher = () => {
    setMatcherEntries([...matcherEntries, { type: "tls" }]);
  };

  const removeMatcher = (index: number) => {
    setMatcherEntries(matcherEntries.filter((_, i) => i !== index));
  };

  const updateMatcher = (index: number, update: Partial<MatcherEntry>) => {
    setMatcherEntries(matcherEntries.map((e, i) => (i === index ? { ...e, ...update } : e)));
  };

  const addUpstream = () => {
    setUpstreamEntries([...upstreamEntries, { dial: "", tlsEnabled: false, tlsInsecureSkipVerify: false, tlsServerName: "" }]);
  };

  const removeUpstream = (index: number) => {
    setUpstreamEntries(upstreamEntries.filter((_, i) => i !== index));
  };

  const updateUpstream = (index: number, update: Partial<UpstreamEntry>) => {
    setUpstreamEntries(upstreamEntries.map((e, i) => (i === index ? { ...e, ...update } : e)));
  };

  return (
    <Stack component="form" id={formId} action={(fd: FormData) => {
      // Inject computed JSON fields
      const matchers = matcherEntriesToJson(matcherEntries);
      if (matchers) fd.set("matchers", JSON.stringify(matchers));
      const upstreams = upstreamEntriesToJson(upstreamEntries);
      if (upstreams) fd.set("upstreams_json", JSON.stringify(upstreams));
      if (tlsTermination && certificateId) fd.set("certificate_id", certificateId);

      // Build meta JSON
      const meta: L4RouteMeta = {};
      if (lbPolicy) meta.load_balancing = { policy: lbPolicy as L4LoadBalancingPolicy };
      const hc: Record<string, unknown> = {};
      if (hcInterval.trim()) hc.interval = hcInterval.trim();
      if (hcTimeout.trim()) hc.timeout = hcTimeout.trim();
      if (hcPort.trim()) { const p = Number(hcPort); if (p > 0) hc.port = p; }
      if (Object.keys(hc).length > 0) meta.health_check = hc as L4RouteMeta["health_check"];
      const thr: Record<string, number> = {};
      if (throttleRead.trim()) { const v = Number(throttleRead); if (v > 0) thr.read_bytes_per_second = v; }
      if (throttleWrite.trim()) { const v = Number(throttleWrite); if (v > 0) thr.write_bytes_per_second = v; }
      if (Object.keys(thr).length > 0) meta.throttle = thr as L4RouteMeta["throttle"];
      // IP Block
      if (ipBlockEnabled) {
        const ipBlock: L4IpBlockOverride = { mode: ipBlockMode };
        if (blockCidrs.length > 0) ipBlock.block_cidrs = blockCidrs;
        if (allowCidrs.length > 0) ipBlock.allow_cidrs = allowCidrs;
        meta.ip_block = ipBlock;
      } else if (initialData?.meta?.ip_block) {
        // Explicitly disable if it was previously set
        meta.ip_block = { mode: "disabled" };
      }
      if (Object.keys(meta).length > 0) fd.set("meta", JSON.stringify(meta));

      formAction(fd);
    }} spacing={2.5}>
      {isEdit && initialData && (
        <input type="hidden" name="id" value={initialData.id} />
      )}

      {/* General */}
      <TextField
        name="name"
        label="Name"
        placeholder="My TCP Service"
        defaultValue={initialData ? (isEdit ? initialData.name : `${initialData.name} (Copy)`) : ""}
        required
        fullWidth
      />

      <TextField
        name="listen_addresses"
        label="Listen Addresses"
        placeholder={":25\ntcp/:587\nudp/:5060"}
        value={listenAddrs}
        onChange={(e) => {
          setListenAddrs(e.target.value);
          // Clear proxy protocol if switching to UDP
          if (e.target.value.split("\n").some((a) => a.trim().toLowerCase().startsWith("udp/"))) {
            setProxyProtocol("");
          }
        }}
        helperText="One per line. Format: [protocol/][host]:port (e.g. :25, tcp/:587, udp/:5060)"
        multiline
        minRows={2}
        required
        fullWidth
      />

      <TextField
        select
        name="handler_type"
        label="Handler Type"
        value={handlerType}
        onChange={(e) => {
          setHandlerType(e.target.value as L4HandlerType);
          if (e.target.value !== "proxy") setProxyProtocol("");
        }}
        fullWidth
      >
        {HANDLER_TYPES.map((ht) => (
          <MenuItem key={ht.value} value={ht.value}>
            {ht.label}
          </MenuItem>
        ))}
      </TextField>

      {/* Matchers */}
      <Accordion defaultExpanded={matcherEntries.length > 0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">
            Matchers {matcherEntries.length > 0 && <Chip label={matcherEntries.length} size="small" sx={{ ml: 1 }} />}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Matchers determine which connections this route handles. Without matchers, all connections on the listen addresses are matched.
            </Typography>
            {matcherEntries.map((entry, index) => (
              <Stack key={index} direction="row" spacing={1} alignItems="flex-start" sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Stack spacing={1.5} sx={{ flex: 1 }}>
                  <TextField
                    select
                    label="Matcher Type"
                    value={entry.type}
                    onChange={(e) => updateMatcher(index, { type: e.target.value })}
                    size="small"
                    fullWidth
                  >
                    {MATCHER_TYPES.map((mt) => (
                      <MenuItem key={mt.value} value={mt.value}>{mt.label}</MenuItem>
                    ))}
                  </TextField>
                  {entry.type === "tls" && (
                    <>
                      <TextField
                        label="SNI Hostnames"
                        placeholder="mail.example.com, *.example.com"
                        value={entry.sni ?? ""}
                        onChange={(e) => updateMatcher(index, { sni: e.target.value })}
                        size="small"
                        fullWidth
                        helperText="Comma-separated TLS Server Name Indication values"
                      />
                      <TextField
                        label="ALPN Protocols"
                        placeholder="h2, http/1.1"
                        value={entry.alpn ?? ""}
                        onChange={(e) => updateMatcher(index, { alpn: e.target.value })}
                        size="small"
                        fullWidth
                        helperText="Comma-separated ALPN protocol names"
                      />
                    </>
                  )}
                  {(entry.type === "remote_ip" || entry.type === "local_ip") && (
                    <TextField
                      label="IP Ranges (CIDR)"
                      placeholder="10.0.0.0/8, 192.168.1.0/24"
                      value={entry.ranges ?? ""}
                      onChange={(e) => updateMatcher(index, { ranges: e.target.value })}
                      size="small"
                      fullWidth
                      helperText="Comma-separated IP addresses or CIDR ranges"
                    />
                  )}
                  {!["tls", "remote_ip", "local_ip"].includes(entry.type) && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                      Matches connections that look like {entry.type.toUpperCase()} protocol
                    </Typography>
                  )}
                </Stack>
                <IconButton size="small" color="error" onClick={() => removeMatcher(index)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Button startIcon={<AddIcon />} size="small" onClick={addMatcher}>
              Add Matcher
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Upstreams (only for proxy handler) */}
      {handlerType === "proxy" && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              Upstreams {upstreamEntries.filter((u) => u.dial.trim()).length > 0 && (
                <Chip label={upstreamEntries.filter((u) => u.dial.trim()).length} size="small" sx={{ ml: 1 }} />
              )}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Upstream backends to proxy connections to. At least one is required for proxy handler.
              </Typography>
              {upstreamEntries.map((entry, index) => (
                <Stack key={index} spacing={1} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      label="Dial Address"
                      placeholder="host.docker.internal:11111"
                      value={entry.dial}
                      onChange={(e) => updateUpstream(index, { dial: e.target.value })}
                      size="small"
                      fullWidth
                      helperText="Format: [protocol/]host:port"
                    />
                    <IconButton size="small" color="error" onClick={() => removeUpstream(index)} disabled={upstreamEntries.length <= 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={entry.tlsEnabled}
                        onChange={(e) => updateUpstream(index, { tlsEnabled: e.target.checked })}
                        size="small"
                      />
                    }
                    label={<Typography variant="body2">TLS to upstream</Typography>}
                  />
                  {entry.tlsEnabled && (
                    <Stack direction="row" spacing={1}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={entry.tlsInsecureSkipVerify}
                            onChange={(e) => updateUpstream(index, { tlsInsecureSkipVerify: e.target.checked })}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">Skip TLS verification</Typography>}
                      />
                      <TextField
                        label="Server Name"
                        placeholder="backend.internal"
                        value={entry.tlsServerName}
                        onChange={(e) => updateUpstream(index, { tlsServerName: e.target.value })}
                        size="small"
                      />
                    </Stack>
                  )}
                </Stack>
              ))}
              <Button startIcon={<AddIcon />} size="small" onClick={addUpstream}>
                Add Upstream
              </Button>
              {upstreamEntries.filter((u) => u.dial.trim()).length > 1 && (
                <TextField
                  select
                  label="Load Balancing Policy"
                  value={lbPolicy}
                  onChange={(e) => setLbPolicy(e.target.value)}
                  size="small"
                  fullWidth
                  helperText="How to distribute connections across upstreams"
                >
                  <MenuItem value="">None (default)</MenuItem>
                  {LB_POLICIES.map((p) => (
                    <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Health Checks (proxy only) */}
      {handlerType === "proxy" && (
        <Accordion defaultExpanded={!!(initialData?.meta?.health_check)}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              Health Checks {(hcInterval || hcTimeout || hcPort) && <Chip label="Active" size="small" color="success" sx={{ ml: 1 }} />}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Actively checks upstream health at regular intervals. Unhealthy upstreams are removed from the pool.
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Interval"
                  placeholder="5s"
                  value={hcInterval}
                  onChange={(e) => setHcInterval(e.target.value)}
                  size="small"
                  fullWidth
                  helperText="How often to check (e.g. 5s, 30s)"
                />
                <TextField
                  label="Timeout"
                  placeholder="3s"
                  value={hcTimeout}
                  onChange={(e) => setHcTimeout(e.target.value)}
                  size="small"
                  fullWidth
                  helperText="Timeout per check attempt"
                />
                <TextField
                  label="Port"
                  placeholder="Auto"
                  value={hcPort}
                  onChange={(e) => setHcPort(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                  helperText="Override port (defaults to upstream)"
                />
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {/* TLS & Advanced */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">TLS &amp; Advanced</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Checkbox
                  name="tls_termination"
                  checked={tlsTermination}
                  onChange={(e) => setTlsTermination(e.target.checked)}
                  value="on"
                />
              }
              label="Terminate TLS before handling"
            />
            {tlsTermination && certificates && certificates.length > 0 && (
              <TextField
                select
                label="TLS Certificate"
                value={certificateId}
                onChange={(e) => setCertificateId(e.target.value)}
                fullWidth
                helperText="Select a certificate or leave empty for automatic ACME provisioning"
              >
                <MenuItem value="">Auto-managed (ACME)</MenuItem>
                {certificates.map((cert) => (
                  <MenuItem key={cert.id} value={cert.id.toString()}>
                    {cert.name} ({cert.domain_names.join(", ")})
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              name="proxy_protocol"
              label="Proxy Protocol"
              value={proxyProtocol}
              onChange={(e) => setProxyProtocol(e.target.value)}
              disabled={ppDisabled}
              fullWidth
              helperText={ppHelperText}
            >
              <MenuItem value="">None</MenuItem>
              <MenuItem value="v1">v1</MenuItem>
              <MenuItem value="v2">v2</MenuItem>
            </TextField>
            <TextField
              name="matching_timeout"
              label="Matching Timeout"
              placeholder="3s"
              defaultValue={initialData?.matching_timeout ?? ""}
              helperText="Maximum duration for connection matching phase (default: 3s)"
              fullWidth
            />
            <Typography variant="subtitle2" sx={{ pt: 1 }}>Throttle</Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Read (bytes/sec)"
                placeholder="1048576"
                value={throttleRead}
                onChange={(e) => setThrottleRead(e.target.value)}
                size="small"
                fullWidth
                type="number"
                helperText="Limit inbound throughput (e.g. 1048576 = 1 MB/s)"
              />
              <TextField
                label="Write (bytes/sec)"
                placeholder="1048576"
                value={throttleWrite}
                onChange={(e) => setThrottleWrite(e.target.value)}
                size="small"
                fullWidth
                type="number"
                helperText="Limit outbound throughput"
              />
            </Stack>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* IP Blocking */}
      <Box
        sx={{
          borderRadius: 2,
          border: "1px solid",
          borderColor: "warning.main",
          bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(237,108,2,0.06)" : "rgba(237,108,2,0.04)",
          p: 2,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>IP Blocking</Typography>
            <Typography variant="body2" color="text.secondary">
              Block or allow connections by CIDR range. GeoIP features (countries, continents, ASNs) are not available for L4 routes — they operate at the TCP/UDP layer where there is no HTTP request to inspect.
            </Typography>
          </Box>
          <Switch
            checked={ipBlockEnabled}
            onChange={(_, checked) => setIpBlockEnabled(checked)}
          />
        </Stack>
        <Collapse in={ipBlockEnabled} timeout="auto" unmountOnExit>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary" mb={1.5} display="block">
            These settings merge with or override the L4 global IP block rules configured in Settings, not the HTTP GeoBlock settings.
          </Typography>
          <Stack direction="row" spacing={1} mb={2}>
            {(["inherit", "override"] as const).map((v) => (
              <Box
                key={v}
                onClick={() => setIpBlockMode(v)}
                sx={{
                  flex: 1,
                  py: 0.75,
                  px: 1.5,
                  borderRadius: 1.5,
                  border: "1.5px solid",
                  borderColor: ipBlockMode === v ? "warning.main" : "divider",
                  bgcolor: ipBlockMode === v
                    ? (theme) => theme.palette.mode === "dark" ? "rgba(237,108,2,0.12)" : "rgba(237,108,2,0.08)"
                    : "transparent",
                  cursor: "pointer",
                  textAlign: "center",
                  userSelect: "none",
                }}
              >
                <Typography
                  variant="body2"
                  fontWeight={ipBlockMode === v ? 600 : 400}
                  color={ipBlockMode === v ? "warning.main" : "text.secondary"}
                >
                  {v === "inherit" ? "Merge with global" : "Override global"}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" fontWeight={600} mb={0.5}>Block CIDRs</Typography>
              <TextField
                size="small"
                fullWidth
                value={blockCidrInput}
                placeholder={blockCidrs.length === 0 ? "10.0.0.0/8, 192.168.0.0/16…" : undefined}
                helperText="Press Enter or comma to add"
                onChange={(e) => setBlockCidrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "," || e.key === "Enter") {
                    e.preventDefault();
                    const v = blockCidrInput.trim();
                    if (v && !blockCidrs.includes(v)) setBlockCidrs([...blockCidrs, v]);
                    setBlockCidrInput("");
                  }
                  if (e.key === "Backspace" && !blockCidrInput && blockCidrs.length > 0) {
                    setBlockCidrs(blockCidrs.slice(0, -1));
                  }
                }}
                onBlur={() => {
                  const v = blockCidrInput.trim();
                  if (v && !blockCidrs.includes(v)) setBlockCidrs([...blockCidrs, v]);
                  setBlockCidrInput("");
                }}
                slotProps={{
                  input: {
                    startAdornment: blockCidrs.length > 0 ? (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mr: 0.5, my: 0.25 }}>
                        {blockCidrs.map((c) => (
                          <Chip key={c} label={c} size="small" color="warning" variant="outlined"
                            onDelete={() => setBlockCidrs(blockCidrs.filter((x) => x !== c))}
                            sx={{ height: 20, fontSize: "0.68rem" }}
                          />
                        ))}
                      </Box>
                    ) : undefined,
                  },
                }}
              />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={600} mb={0.5}>Allow CIDRs</Typography>
              <Typography variant="caption" color="text.secondary" mb={0.5} display="block">
                Allow rules take precedence over block rules.
              </Typography>
              <TextField
                size="small"
                fullWidth
                value={allowCidrInput}
                placeholder={allowCidrs.length === 0 ? "172.16.0.0/12…" : undefined}
                helperText="Press Enter or comma to add"
                onChange={(e) => setAllowCidrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "," || e.key === "Enter") {
                    e.preventDefault();
                    const v = allowCidrInput.trim();
                    if (v && !allowCidrs.includes(v)) setAllowCidrs([...allowCidrs, v]);
                    setAllowCidrInput("");
                  }
                  if (e.key === "Backspace" && !allowCidrInput && allowCidrs.length > 0) {
                    setAllowCidrs(allowCidrs.slice(0, -1));
                  }
                }}
                onBlur={() => {
                  const v = allowCidrInput.trim();
                  if (v && !allowCidrs.includes(v)) setAllowCidrs([...allowCidrs, v]);
                  setAllowCidrInput("");
                }}
                slotProps={{
                  input: {
                    startAdornment: allowCidrs.length > 0 ? (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.4, mr: 0.5, my: 0.25 }}>
                        {allowCidrs.map((c) => (
                          <Chip key={c} label={c} size="small" color="success" variant="outlined"
                            onDelete={() => setAllowCidrs(allowCidrs.filter((x) => x !== c))}
                            sx={{ height: 20, fontSize: "0.68rem" }}
                          />
                        ))}
                      </Box>
                    ) : undefined,
                  },
                }}
              />
            </Box>
          </Stack>
        </Collapse>
      </Box>
    </Stack>
  );
}

// ── Create Dialog ──

export function CreateL4RouteDialog({
  open,
  onClose,
  initialData,
  certificates,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: L4Route | null;
  certificates?: Certificate[];
}) {
  const [state, formAction] = useActionState(createL4RouteAction, INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={initialData ? "Duplicate L4 Route" : "Create L4 Route"}
      maxWidth="md"
      submitLabel="Create"
      onSubmit={() => {
        (document.getElementById("create-l4-route-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      {state.status !== "idle" && state.message && (
        <Alert severity={state.status === "error" ? "error" : "success"} sx={{ mb: 2 }}>
          {state.message}
        </Alert>
      )}
      <L4RouteForm
        formId="create-l4-route-form"
        formAction={formAction}
        initialData={initialData}
        certificates={certificates}
      />
    </AppDialog>
  );
}

// ── Edit Dialog ──

export function EditL4RouteDialog({
  open,
  route,
  onClose,
  certificates,
}: {
  open: boolean;
  route: L4Route;
  onClose: () => void;
  certificates?: Certificate[];
}) {
  const [state, formAction] = useActionState(updateL4RouteAction, INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Edit L4 Route"
      maxWidth="md"
      submitLabel="Save"
      onSubmit={() => {
        (document.getElementById("edit-l4-route-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      {state.status !== "idle" && state.message && (
        <Alert severity={state.status === "error" ? "error" : "success"} sx={{ mb: 2 }}>
          {state.message}
        </Alert>
      )}
      <L4RouteForm
        formId="edit-l4-route-form"
        formAction={formAction}
        initialData={route}
        isEdit
        certificates={certificates}
      />
    </AppDialog>
  );
}

// ── Delete Dialog ──

export function DeleteL4RouteDialog({
  open,
  route,
  onClose,
}: {
  open: boolean;
  route: L4Route;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(async () => deleteL4RouteAction(route.id), INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete L4 Route"
      maxWidth="sm"
      submitLabel="Delete"
      onSubmit={() => {
        (document.getElementById("delete-l4-route-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <Stack component="form" id="delete-l4-route-form" action={formAction} spacing={2}>
        {state.status !== "idle" && state.message && (
          <Alert severity={state.status === "error" ? "error" : "success"}>
            {state.message}
          </Alert>
        )}
        <Typography variant="body1">
          Are you sure you want to delete the L4 route <strong>{route.name}</strong>?
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This will remove the configuration for:
        </Typography>
        <Box sx={{ pl: 2 }}>
          <Typography variant="body2" color="text.secondary">
            • Listen: {route.listen_addresses.join(", ")}
          </Typography>
          {route.upstreams && route.upstreams.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              • Upstreams: {route.upstreams.map((u) => u.dial?.[0]).filter(Boolean).join(", ")}
            </Typography>
          )}
        </Box>
        <Typography variant="body2" color="error.main" fontWeight={500}>
          This action cannot be undone.
        </Typography>
      </Stack>
    </AppDialog>
  );
}
