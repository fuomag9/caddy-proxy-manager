"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Chip, Stack, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { DataTable } from "@/src/components/ui/DataTable";

type EventRow = {
  id: number;
  created_at: string;
  user: string;
  summary: string;
};

type Props = {
  events: EventRow[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function AuditLogClient({ events, pagination, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
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
        params.delete("page"); // reset to page 1 on new search
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const columns = [
    {
      id: "created_at",
      label: "Time",
      width: 180,
      render: (r: EventRow) => (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {new Date(r.created_at).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: "user",
      label: "User",
      width: 160,
      render: (r: EventRow) => (
        <Chip label={r.user} size="small" variant="outlined" />
      ),
    },
    {
      id: "summary",
      label: "Event",
      render: (r: EventRow) => (
        <Typography variant="body2">{r.summary}</Typography>
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Typography variant="h4" fontWeight={600}>
        Audit Log
      </Typography>
      <Typography color="text.secondary">Review configuration changes and user activity.</Typography>

      <TextField
        placeholder="Search audit log..."
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          updateSearch(e.target.value);
        }}
        slotProps={{
          input: {
            startAdornment: <SearchIcon sx={{ mr: 1, color: "rgba(255, 255, 255, 0.5)" }} />,
          },
        }}
        size="small"
        sx={{ maxWidth: 400 }}
      />

      <DataTable
        columns={columns}
        data={events}
        keyField="id"
        emptyMessage="No audit events found"
        pagination={pagination}
      />
    </Stack>
  );
}
