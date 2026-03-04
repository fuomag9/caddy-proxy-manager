"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { DataTable } from "@/src/components/ui/DataTable";
import type { WafEvent } from "@/src/lib/models/waf-events";

type Props = {
  events: WafEvent[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
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

function WafEventDrawer({ event, onClose }: { event: WafEvent | null; onClose: () => void }) {
  // Parse rawData safely — render as text only, never as HTML
  let parsedRaw: unknown = null;
  if (event?.rawData) {
    try { parsedRaw = JSON.parse(event.rawData); } catch { parsedRaw = event.rawData; }
  }

  return (
    <Drawer anchor="right" open={!!event} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520 }, p: 3 } }}>
      {event && (
        <Stack spacing={2.5} sx={{ height: "100%", overflow: "auto" }}>
          {/* Header */}
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" spacing={1}>
              <SeverityChip severity={event.severity} />
              <Typography variant="h6" fontWeight={600}>WAF Event</Typography>
            </Stack>
            <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
          </Stack>

          <Divider />

          {/* Fields */}
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
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{event.ruleId ?? "—"}</Typography>
          </DetailRow>

          <DetailRow label="Rule Message">
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{event.ruleMessage ?? "—"}</Typography>
          </DetailRow>

          <Divider />

          {/* Raw audit log — rendered as plain text, never as HTML */}
          <DetailRow label="Raw Audit Data">
            {parsedRaw !== null ? (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  userSelect: "text",
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
  );
}

export default function WafEventsClient({ events, pagination, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [selected, setSelected] = useState<WafEvent | null>(null);
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
      id: "ts",
      label: "Time",
      width: 150,
      render: (r: WafEvent) => (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}>
          {new Date(r.ts * 1000).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: "severity",
      label: "Severity",
      width: 100,
      render: (r: WafEvent) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host",
      label: "Host",
      width: 150,
      render: (r: WafEvent) => (
        <Tooltip title={r.host ?? ""} placement="top">
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.host || <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: "clientIp",
      label: "Client IP",
      width: 140,
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
      id: "method",
      label: "M",
      width: 60,
      render: (r: WafEvent) => (
        <Chip label={r.method || "—"} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.7rem" }} />
      ),
    },
    {
      id: "uri",
      label: "URI",
      width: 200,
      render: (r: WafEvent) => (
        <Tooltip title={r.uri} placement="top">
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {r.uri || <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: "ruleId",
      label: "Rule ID",
      width: 80,
      render: (r: WafEvent) => (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {r.ruleId ?? "—"}
        </Typography>
      ),
    },
    {
      id: "ruleMessage",
      label: "Rule Message",
      render: (r: WafEvent) => (
        <Tooltip title={r.ruleMessage ?? ""} placement="top">
          <Typography
            variant="body2"
            sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {r.ruleMessage ?? <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Typography variant="h4" fontWeight={600}>
        WAF Events
      </Typography>
      <Typography color="text.secondary">
        Web Application Firewall detections and blocks. Events are retained for 90 days.
      </Typography>

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
        emptyMessage="No WAF events found. Enable the WAF in Settings and send some traffic to see events here."
        pagination={pagination}
        onRowClick={setSelected}
      />

      <WafEventDrawer event={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
