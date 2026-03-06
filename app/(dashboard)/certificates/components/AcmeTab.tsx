"use client";

import { Chip, Typography } from "@mui/material";
import { DataTable } from "@/src/components/ui/DataTable";
import type { AcmeHost, CertExpiryStatus } from "../page";
import { RelativeTime } from "./RelativeTime";

type Props = {
  acmeHosts: AcmeHost[];
  acmePagination: { total: number; page: number; perPage: number };
  search: string;
  statusFilter: string | null;
};

const columns = [
  {
    id: "name",
    label: "Proxy Host",
    render: (r: AcmeHost) => <Typography fontWeight={600}>{r.name}</Typography>,
  },
  {
    id: "domains",
    label: "Domains",
    render: (r: AcmeHost) => (
      <Typography variant="body2" color="text.secondary">
        {r.domains.join(", ")}
      </Typography>
    ),
  },
  {
    id: "issuer",
    label: "Issuer",
    render: (r: AcmeHost) => (
      <Typography variant="body2" color="text.secondary">
        {r.certIssuer ?? "—"}
      </Typography>
    ),
  },
  {
    id: "expiry",
    label: "Expiry",
    render: (r: AcmeHost) => <RelativeTime validTo={r.certValidTo} status={r.certExpiryStatus} />,
  },
  {
    id: "status",
    label: "Status",
    render: (r: AcmeHost) => (
      <Chip
        label={r.enabled ? "Active" : "Disabled"}
        color={r.enabled ? "success" : "default"}
        size="small"
      />
    ),
  },
];

export function AcmeTab({ acmeHosts, acmePagination, search, statusFilter }: Props) {
  const filtered = acmeHosts.filter((h) => {
    if (statusFilter && h.certExpiryStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // When filtering client-side, pass a fake pagination that disables server pagination display
  const pagination =
    search || statusFilter
      ? { total: filtered.length, page: 1, perPage: filtered.length || 1 }
      : acmePagination;

  return (
    <DataTable
      columns={columns}
      data={filtered}
      keyField="id"
      emptyMessage="No ACME certificates match"
      pagination={pagination}
    />
  );
}
