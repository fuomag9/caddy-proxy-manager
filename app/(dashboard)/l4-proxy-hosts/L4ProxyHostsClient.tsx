"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { L4ProxyHost } from "@/src/lib/models/l4-proxy-hosts";
import { toggleL4ProxyHostAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateL4HostDialog, EditL4HostDialog, DeleteL4HostDialog } from "@/components/l4-proxy-hosts/L4HostDialogs";
import { L4PortsApplyBanner } from "@/components/l4-proxy-hosts/L4PortsApplyBanner";

type Props = {
  hosts: L4ProxyHost[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

function formatMatcher(host: L4ProxyHost): string {
  switch (host.matcher_type) {
    case "tls_sni":    return `SNI: ${host.matcher_value.join(", ")}`;
    case "http_host":  return `Host: ${host.matcher_value.join(", ")}`;
    case "proxy_protocol": return "Proxy Protocol";
    default:           return "None";
  }
}

export default function L4ProxyHostsClient({ hosts, pagination, initialSearch }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateHost, setDuplicateHost] = useState<L4ProxyHost | null>(null);
  const [editHost, setEditHost] = useState<L4ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<L4ProxyHost | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [bannerRefresh, setBannerRefresh] = useState(0);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signalBannerRefresh = () => setBannerRefresh(n => n + 1);

  useEffect(() => { setSearchTerm(initialSearch); }, [initialSearch]);

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) { params.set("search", value.trim()); } else { params.delete("search"); }
      params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    }, 400);
  }

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    await toggleL4ProxyHostAction(id, enabled);
    signalBannerRefresh();
  };

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (host: L4ProxyHost) => (
        <div>
          <p className="text-sm font-medium">{host.name}</p>
          <p className="text-xs text-muted-foreground">{formatMatcher(host)}</p>
        </div>
      ),
    },
    {
      id: "protocol",
      label: "Protocol",
      width: 90,
      render: (host: L4ProxyHost) => (
        <Badge variant={host.protocol === "tcp" ? "default" : "secondary"}>
          {host.protocol.toUpperCase()}
        </Badge>
      ),
    },
    {
      id: "listen",
      label: "Listen",
      render: (host: L4ProxyHost) => (
        <span className="text-sm text-muted-foreground font-mono">{host.listen_address}</span>
      ),
    },
    {
      id: "upstreams",
      label: "Upstreams",
      render: (host: L4ProxyHost) => (
        <span className="text-sm text-muted-foreground font-mono">
          {host.upstreams[0]}{host.upstreams.length > 1 && ` +${host.upstreams.length - 1} more`}
        </span>
      ),
    },
    {
      id: "status",
      label: "Status",
      width: 100,
      render: (host: L4ProxyHost) => (
        <Badge variant={host.enabled ? "default" : "secondary"}>
          {host.enabled ? "Active" : "Paused"}
        </Badge>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      width: 80,
      render: (host: L4ProxyHost) => (
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

  const mobileCard = (host: L4ProxyHost) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{host.name}</p>
              <Badge variant={host.protocol === "tcp" ? "default" : "secondary"}>
                {host.protocol.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {host.listen_address} → {host.upstreams[0]}{host.upstreams.length > 1 ? ` +${host.upstreams.length - 1}` : ""}
            </p>
            <Badge variant={host.enabled ? "default" : "secondary"} className="w-fit mt-1">
              {host.enabled ? "Active" : "Paused"}
            </Badge>
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
      <L4PortsApplyBanner refreshSignal={bannerRefresh} />

      <PageHeader
        title="L4 Proxy Hosts"
        description="Define TCP/UDP stream proxies powered by caddy-l4. Port mappings are applied automatically."
        action={{ label: "Create L4 Host", onClick: () => setCreateOpen(true) }}
      />

      <div className="flex items-center gap-2">
        <SearchField
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search L4 hosts..."
        />
      </div>

      <DataTable
        columns={columns}
        data={hosts}
        keyField="id"
        emptyMessage={searchTerm ? "No L4 hosts match your search" : "No L4 proxy hosts found"}
        pagination={pagination}
        mobileCard={mobileCard}
      />

      <CreateL4HostDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setTimeout(() => setDuplicateHost(null), 200); signalBannerRefresh(); }}
        initialData={duplicateHost}
      />

      {editHost && (
        <EditL4HostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => { setEditHost(null); signalBannerRefresh(); }}
        />
      )}

      {deleteHost && (
        <DeleteL4HostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => { setDeleteHost(null); signalBannerRefresh(); }}
        />
      )}
    </div>
  );
}
