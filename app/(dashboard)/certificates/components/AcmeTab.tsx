"use client";

import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AcmeHost } from "../page";

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
    render: (r: AcmeHost) => (
      <div className="flex items-start gap-3">
        <div className={[
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
          r.enabled
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
            : "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
        ].join(" ")}>
          <Lock className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">{r.name}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {r.domains[0]}
            {r.domains.length > 1 && (
              <span className="ml-1 text-muted-foreground">+{r.domains.length - 1}</span>
            )}
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "status",
    label: "Status",
    width: 110,
    render: (r: AcmeHost) => (
      <StatusChip status={r.enabled ? "active" : "inactive"} />
    ),
  },
];

function acmeMobileCard(r: AcmeHost) {
  return (
    <Card className={["border-l-2", r.enabled ? "border-l-emerald-500" : "border-l-zinc-500/30"].join(" ")}>
      <CardContent className="p-4 flex flex-col gap-1.5">
        <p className="text-sm font-semibold">{r.name}</p>
        <p className="text-xs text-muted-foreground font-mono">
          {r.domains[0]}{r.domains.length > 1 ? ` +${r.domains.length - 1}` : ""}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <StatusChip status={r.enabled ? "active" : "inactive"} />
        </div>
      </CardContent>
    </Card>
  );
}

export function AcmeTab({ acmeHosts, acmePagination, search, statusFilter }: Props) {
  const filtered = acmeHosts.filter((h) => {
    if (statusFilter) return false; // ACME hosts have no expiry status
    if (search) {
      const q = search.toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

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
      rowClassName={(r) => r.enabled ? "" : "opacity-75"}
    />
  );
}
