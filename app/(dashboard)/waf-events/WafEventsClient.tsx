"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import DeleteIcon from "@mui/icons-material/Delete";
import { DataTable } from "@/src/components/ui/DataTable";
import type { WafEvent } from "@/src/lib/models/waf-events";
import {
  suppressWafRuleGloballyAction,
  suppressWafRuleForHostAction,
  removeWafRuleGloballyAction,
} from "../settings/actions";

type Props = {
  events: WafEvent[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  globalExcluded: number[];
  globalExcludedMessages: Record<number, string | null>;
  globalWafEnabled: boolean;
  hostWafMap: Record<string, number[]>;
};

const SEVERITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  CRITICAL: "error",
  ERROR: "error",
  HIGH: "error",
  WARNING: "warning",
  NOTICE: "info",
  INFO: "info",
};

function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const upper = severity.toUpperCase();
  const color = SEVERITY_COLOR[upper] ?? "default";
  return <Chip label={upper} size="small" color={color} variant="outlined" sx={{ fontWeight: 600, fontSize: "0.7rem" }} />;
}

function BlockedChip({ blocked }: { blocked: boolean }) {
  return blocked
    ? <Chip label="Blocked" size="small" color="error" sx={{ fontWeight: 600, fontSize: "0.7rem" }} />
    : <Chip label="Detected" size="small" color="warning" variant="outlined" sx={{ fontWeight: 600, fontSize: "0.7rem" }} />;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Box mt={0.25}>{children}</Box>
    </Box>
  );
}

function WafEventDrawer({
  event,
  onClose,
  globalExcluded,
  hostWafMap,
  onSuppressGlobal,
  onSuppressHost,
}: {
  event: WafEvent | null;
  onClose: () => void;
  globalExcluded: number[];
  hostWafMap: Record<string, number[]>;
  onSuppressGlobal: (ruleId: number) => void;
  onSuppressHost: (ruleId: number, host: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; success: boolean }>({ open: false, message: "", success: true });

  let parsedRaw: unknown = null;
  if (event?.rawData) {
    try { parsedRaw = JSON.parse(event.rawData); } catch { parsedRaw = event.rawData; }
  }

  const isGloballySuppressed = event?.ruleId != null && globalExcluded.includes(event.ruleId);
  const isHostOnlySuppressed = event?.ruleId != null && !!event.host && (hostWafMap[event.host] ?? []).includes(event.ruleId);
  const isHostSuppressed = isGloballySuppressed || isHostOnlySuppressed;

  function handleSuppressGlobally() {
    if (!event?.ruleId) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(event.ruleId!);
      setSnackbar({ open: true, message: result.message ?? (result.success ? "Done" : "Failed"), success: result.success });
      if (result.success) onSuppressGlobal(event.ruleId!);
    });
  }

  function handleSuppressForHost() {
    if (!event?.ruleId || !event?.host) return;
    startTransition(async () => {
      const result = await suppressWafRuleForHostAction(event.ruleId!, event.host!);
      setSnackbar({ open: true, message: result.message ?? (result.success ? "Done" : "Failed"), success: result.success });
      if (result.success) onSuppressHost(event.ruleId!, event.host!);
    });
  }

  return (
    <>
      <Drawer anchor="right" open={!!event} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520 }, p: 3 } }}>
        {event && (
          <Stack spacing={2.5} sx={{ height: "100%", overflow: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="center" spacing={1}>
                <BlockedChip blocked={event.blocked} />
                <SeverityChip severity={event.severity} />
                <Typography variant="h6" fontWeight={600}>WAF Event</Typography>
              </Stack>
              <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </Stack>

            <Divider />

            <DetailRow label="Time">
              <Typography variant="body2">{new Date(event.ts * 1000).toLocaleString()}</Typography>
            </DetailRow>

            <DetailRow label="Host">
              <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{event.host || "—"}</Typography>
            </DetailRow>

            <DetailRow label="Client IP">
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{event.clientIp}</Typography>
                {event.countryCode && <Chip label={event.countryCode} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />}
              </Stack>
            </DetailRow>

            <DetailRow label="Request">
              <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                {event.method} {event.uri}
              </Typography>
            </DetailRow>

            <DetailRow label="Rule ID">
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{event.ruleId ?? "—"}</Typography>
                {event.ruleId != null && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<BlockIcon fontSize="small" />}
                      onClick={handleSuppressGlobally}
                      disabled={pending || isGloballySuppressed}
                      sx={{ fontSize: "0.72rem", textTransform: "none" }}
                    >
                      {isGloballySuppressed ? "Suppressed Globally" : "Suppress Globally"}
                    </Button>
                    {event.host && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        startIcon={<BlockIcon fontSize="small" />}
                        onClick={handleSuppressForHost}
                        disabled={pending || isHostSuppressed}
                        sx={{ fontSize: "0.72rem", textTransform: "none" }}
                      >
                        {isHostSuppressed ? `Suppressed for ${event.host}` : `Suppress for ${event.host}`}
                      </Button>
                    )}
                  </>
                )}
              </Stack>
            </DetailRow>

            <DetailRow label="Rule Message">
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{event.ruleMessage ?? "—"}</Typography>
            </DetailRow>

            <Divider />

            <DetailRow label="Raw Audit Data">
              {parsedRaw !== null ? (
                <Box
                  component="pre"
                  sx={{
                    m: 0, p: 1.5, borderRadius: 1, bgcolor: "action.hover",
                    fontSize: "0.7rem", fontFamily: "monospace", overflowX: "auto",
                    whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "text",
                  }}
                >
                  {JSON.stringify(parsedRaw, null, 2)}
                </Box>
              ) : (
                <Typography variant="body2" color="text.disabled">—</Typography>
              )}
            </DetailRow>
          </Stack>
        )}
      </Drawer>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.success ? "success" : "error"} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}

function GlobalSuppressedRules({
  excluded,
  messages,
  wafEnabled,
  onRemove,
}: {
  excluded: number[];
  messages: Record<number, string | null>;
  wafEnabled: boolean;
  onRemove: (ruleId: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; success: boolean }>({ open: false, message: "", success: true });

  function handleRemove(ruleId: number) {
    startTransition(async () => {
      const result = await removeWafRuleGloballyAction(ruleId);
      setSnackbar({ open: true, message: result.message ?? (result.success ? "Done" : "Failed"), success: result.success });
      if (result.success) onRemove(ruleId);
    });
  }

  return (
    <>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Global WAF Rule Exclusions</Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Rules listed here are suppressed globally via <code>SecRuleRemoveById</code> for all proxy hosts using global WAF settings.
          </Typography>
          {!wafEnabled && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>Global WAF is currently disabled. Exclusions are saved but have no effect until WAF is enabled.</Alert>
          )}
        </Box>

        {excluded.length === 0 ? (
          <Box
            sx={{
              py: 6, textAlign: "center", color: "text.secondary",
              border: "1px dashed", borderColor: "divider", borderRadius: 2,
            }}
          >
            <BlockIcon sx={{ fontSize: 36, opacity: 0.3, mb: 1, display: "block", mx: "auto" }} />
            <Typography variant="body2">No globally suppressed rules.</Typography>
            <Typography variant="caption">Open a WAF event and click "Suppress Globally" to add one.</Typography>
          </Box>
        ) : (
          <Stack spacing={1}>
            {excluded.map((id) => (
              <Box
                key={id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  px: 2,
                  py: 1.5,
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "action.hover",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={700} color="error.light">
                    Rule {id}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={messages[id] ? "text.secondary" : "text.disabled"}
                    sx={{ display: "block", mt: 0.25 }}
                  >
                    {messages[id] ?? "No description available — rule has not triggered yet"}
                  </Typography>
                </Box>
                <Tooltip title="Remove suppression">
                  <IconButton
                    size="small"
                    onClick={() => handleRemove(id)}
                    disabled={pending}
                    color="error"
                    sx={{ flexShrink: 0 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar.success ? "success" : "error"} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}

export default function WafEventsClient({ events, pagination, initialSearch, globalExcluded, globalExcludedMessages, globalWafEnabled, hostWafMap }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(0);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [selected, setSelected] = useState<WafEvent | null>(null);
  const [localGlobalExcluded, setLocalGlobalExcluded] = useState(globalExcluded);
  const [localHostWafMap, setLocalHostWafMap] = useState(hostWafMap);
  useEffect(() => { setSearchTerm(initialSearch); }, [initialSearch]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
          params.set("search", value.trim());
        } else {
          params.delete("search");
        }
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const columns = [
    {
      id: "ts", label: "Time", width: 150,
      render: (r: WafEvent) => (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>
          {new Date(r.ts * 1000).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: "blocked", label: "Action", width: 90,
      render: (r: WafEvent) => <BlockedChip blocked={r.blocked} />,
    },
    {
      id: "severity", label: "Severity", width: 100,
      render: (r: WafEvent) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host", label: "Host", width: 150,
      render: (r: WafEvent) => (
        <Tooltip title={r.host ?? ""} placement="top">
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.host || <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: "clientIp", label: "Client IP", width: 140,
      render: (r: WafEvent) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            {r.clientIp}
          </Typography>
          {r.countryCode && (
            <Chip label={r.countryCode} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />
          )}
        </Stack>
      ),
    },
    {
      id: "method", label: "M", width: 60,
      render: (r: WafEvent) => (
        <Chip label={r.method || "—"} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.7rem" }} />
      ),
    },
    {
      id: "uri", label: "URI", width: 200,
      render: (r: WafEvent) => (
        <Tooltip title={r.uri} placement="top">
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.uri || <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: "ruleId", label: "Rule ID", width: 80,
      render: (r: WafEvent) => (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {r.ruleId ?? "—"}
        </Typography>
      ),
    },
    {
      id: "ruleMessage", label: "Rule Message",
      render: (r: WafEvent) => (
        <Tooltip title={r.ruleMessage ?? ""} placement="top">
          <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.ruleMessage ?? <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Typography variant="h4" fontWeight={600}>WAF</Typography>
      <Typography color="text.secondary">
        Web Application Firewall events and rule management.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Events" />
        <Tab label="Suppressed Rules" />
      </Tabs>

      {tab === 0 && (
        <>
          <TextField
            placeholder="Search by host, IP, URI, or rule message..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); updateSearch(e.target.value); }}
            slotProps={{
              input: { startAdornment: <SearchIcon sx={{ mr: 1, color: "rgba(255,255,255,0.5)" }} /> },
            }}
            size="small"
            sx={{ maxWidth: 480 }}
          />
          <DataTable
            columns={columns}
            data={events}
            keyField="id"
            emptyMessage="No WAF events found. Enable the WAF in Settings and send some traffic — blocked requests appear when the engine is On, detected-only events appear in Detection Only mode."
            pagination={pagination}
            onRowClick={setSelected}
          />
          <WafEventDrawer
            event={selected}
            onClose={() => setSelected(null)}
            globalExcluded={localGlobalExcluded}
            hostWafMap={localHostWafMap}
            onSuppressGlobal={(ruleId) => setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])])}
            onSuppressHost={(ruleId, host) => setLocalHostWafMap((prev) => ({ ...prev, [host]: [...new Set([...(prev[host] ?? []), ruleId])] }))}
          />
        </>
      )}

      {tab === 1 && (
        <GlobalSuppressedRules
          excluded={localGlobalExcluded}
          messages={globalExcludedMessages}
          wafEnabled={globalWafEnabled}
          onRemove={(ruleId) => setLocalGlobalExcluded((prev) => prev.filter((id) => id !== ruleId))}
        />
      )}
    </Stack>
  );
}
