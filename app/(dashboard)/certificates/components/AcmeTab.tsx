"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import type { AcmeHost } from "../page";
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
    render: (r: AcmeHost) => <span className="font-semibold">{r.name}</span>,
  },
  {
    id: "domains",
    label: "Domains",
    render: (r: AcmeHost) => (
      <p className="text-sm text-muted-foreground">{r.domains.join(", ")}</p>
    ),
  },
  {
    id: "issuer",
    label: "Issuer",
    render: (r: AcmeHost) => (
      <p className="text-sm text-muted-foreground">{r.certIssuer ?? "—"}</p>
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
      <Badge variant={r.enabled ? "default" : "secondary"}>
        {r.enabled ? "Active" : "Disabled"}
      </Badge>
    ),
  },
];

function acmeMobileCard(r: AcmeHost) {
  return (
    <Card className="border">
      <CardContent className="p-3 flex flex-col gap-1">
        <span className="text-sm font-bold">{r.name}</span>
        <p className="text-xs text-muted-foreground">{r.domains.join(", ")}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <RelativeTime validTo={r.certValidTo} status={r.certExpiryStatus} />
          <Badge variant={r.enabled ? "default" : "secondary"}>
            {r.enabled ? "Active" : "Disabled"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

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
      mobileCard={acmeMobileCard}
    />
  );
}
