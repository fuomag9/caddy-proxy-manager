"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Globe, MoreHorizontal, ArrowRight, Shield } from "lucide-react";
import type { AccessList } from "@/lib/models/access-lists";
import type { Certificate } from "@/lib/models/certificates";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { AuthentikSettings } from "@/lib/settings";
import { toggleProxyHostAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { CreateHostDialog, EditHostDialog, DeleteHostDialog } from "@/components/proxy-hosts/HostDialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  hosts: ProxyHost[];
  certificates: Certificate[];
  accessLists: AccessList[];
  caCertificates: CaCertificate[];
  authentikDefaults: AuthentikSettings | null;
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  initialSort?: { sortBy: string; sortDir: "asc" | "desc" };
};

export default function ProxyHostsClient({ hosts, certificates, accessLists, caCertificates, authentikDefaults, pagination, initialSearch, initialSort }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateHost, setDuplicateHost] = useState<ProxyHost | null>(null);
  const [editHost, setEditHost] = useState<ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<ProxyHost | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearch);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchTerm(initialSearch);
  }, [initialSearch]);

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("search", value.trim());
      } else {
        params.delete("search");
      }
      params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    }, 400);
  }

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    await toggleProxyHostAction(id, enabled);
  };

  const columns = [
    {
      id: "name",
      label: "Name / Domain",
      sortKey: "name",
      render: (host: ProxyHost) => (
        <div className="flex items-start gap-3">
          <div className={[
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            host.enabled
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-zinc-500/20 bg-zinc-500/10 text-zinc-400"
          ].join(" ")}>
            <Globe className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{host.name}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {host.domains[0]}
              {host.domains.length > 1 && (
                <span className="ml-1 text-muted-foreground">+{host.domains.length - 1}</span>
              )}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "target",
      label: "Upstream",
      sortKey: "upstreams",
      render: (host: ProxyHost) => (
        <div className="flex items-center gap-1.5">
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="text-sm font-mono font-medium text-foreground/80">
            {host.upstreams[0]}
            {host.upstreams.length > 1 && (
              <span className="ml-1 text-muted-foreground">+{host.upstreams.length - 1}</span>
            )}
          </span>
        </div>
      ),
    },
    {
      id: "features",
      label: "Features",
      render: (host: ProxyHost) => (
        <div className="flex flex-wrap gap-1">
          {host.certificate_id && (
            <Badge variant="info" className="text-[10px] px-1.5 py-0">TLS</Badge>
          )}
          {host.access_list_id && (
            <Badge variant="warning" className="text-[10px] px-1.5 py-0">
              <Shield className="h-2.5 w-2.5 mr-0.5" />Auth
            </Badge>
          )}
          {!host.certificate_id && !host.access_list_id && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      id: "status",
      label: "Status",
      sortKey: "enabled",
      width: 110,
      render: (host: ProxyHost) => (
        <StatusChip status={host.enabled ? "active" : "inactive"} />
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      width: 80,
      render: (host: ProxyHost) => (
        <div className="flex items-center gap-2 justify-end">
          <Switch
            checked={host.enabled}
            onCheckedChange={(checked) => handleToggleEnabled(host.id, checked)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditHost(host)}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setDuplicateHost(host); setCreateOpen(true); }}>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteHost(host)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const mobileCard = (host: ProxyHost) => (
    <Card className={[
      "border-l-2",
      host.enabled ? "border-l-emerald-500" : "border-l-zinc-500/30",
    ].join(" ")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm font-semibold truncate">{host.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {host.domains[0]}{host.domains.length > 1 ? ` +${host.domains.length - 1}` : ""}
              <span className="mx-1 text-muted-foreground">→</span>
              {host.upstreams[0]}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <StatusChip status={host.enabled ? "active" : "inactive"} />
              {host.certificate_id && <Badge variant="info" className="text-[10px] px-1.5 py-0">TLS</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Switch
              checked={host.enabled}
              onCheckedChange={(checked) => handleToggleEnabled(host.id, checked)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditHost(host)}>Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setDuplicateHost(host); setCreateOpen(true); }}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteHost(host)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Proxy Hosts"
        description="Define HTTP(S) reverse proxies orchestrated by Caddy with automated certificates."
        action={{ label: "Create Host", onClick: () => setCreateOpen(true) }}
      />

      <div className="flex items-center gap-2">
        <SearchField
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search hosts..."
        />
      </div>

      <DataTable
        columns={columns}
        data={hosts}
        keyField="id"
        emptyMessage={searchTerm ? "No hosts match your search" : "No proxy hosts found"}
        pagination={pagination}
        sort={initialSort}
        mobileCard={mobileCard}
        rowClassName={(host) => host.enabled ? "" : "opacity-75"}
      />

      <CreateHostDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setTimeout(() => setDuplicateHost(null), 200); }}
        initialData={duplicateHost}
        certificates={certificates}
        accessLists={accessLists}
        authentikDefaults={authentikDefaults}
        caCertificates={caCertificates}
      />

      {editHost && (
        <EditHostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => setEditHost(null)}
          certificates={certificates}
          accessLists={accessLists}
          caCertificates={caCertificates}
        />
      )}

      {deleteHost && (
        <DeleteHostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => setDeleteHost(null)}
        />
      )}
    </div>
  );
}
