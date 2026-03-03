"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Chip, Stack, TextField, Tooltip, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
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

export default function WafEventsClient({ events, pagination, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
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
      width: 170,
      render: (r: WafEvent) => (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {new Date(r.ts * 1000).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: "severity",
      label: "Severity",
      width: 110,
      render: (r: WafEvent) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host",
      label: "Host",
      width: 200,
      render: (r: WafEvent) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {r.host || <span style={{ opacity: 0.4 }}>—</span>}
        </Typography>
      ),
    },
    {
      id: "clientIp",
      label: "Client IP",
      width: 160,
      render: (r: WafEvent) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
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
      label: "Method",
      width: 80,
      render: (r: WafEvent) => (
        <Chip label={r.method || "—"} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.7rem" }} />
      ),
    },
    {
      id: "uri",
      label: "URI",
      render: (r: WafEvent) => (
        <Tooltip title={r.uri} placement="top">
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {r.uri || <span style={{ opacity: 0.4 }}>—</span>}
          </Typography>
        </Tooltip>
      ),
    },
    {
      id: "ruleId",
      label: "Rule ID",
      width: 90,
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
            sx={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
      />
    </Stack>
  );
}
