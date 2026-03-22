"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { AccessList } from "@/lib/models/access-lists";
import type { Certificate } from "@/lib/models/certificates";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { AuthentikSettings } from "@/lib/settings";
import { toggleProxyHostAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import { DataTable } from "@/components/ui/DataTable";
import { CreateHostDialog, EditHostDialog, DeleteHostDialog } from "@/components/proxy-hosts/HostDialogs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";

type Props = {
  hosts: ProxyHost[];
  certificates: Certificate[];
  accessLists: AccessList[];
  caCertificates: CaCertificate[];
  authentikDefaults: AuthentikSettings | null;
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function ProxyHostsClient({ hosts, certificates, accessLists, caCertificates, authentikDefaults, pagination, initialSearch }: Props) {
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
      label: "Name",
      render: (host: ProxyHost) => (
        <p className="text-sm font-semibold">{host.name}</p>
      )
    },
    {
      id: "domains",
      label: "Domains",
      render: (host: ProxyHost) => (
        <p className="text-sm text-muted-foreground">
          {host.domains[0]}
          {host.domains.length > 1 && ` +${host.domains.length - 1} more`}
        </p>
      )
    },
    {
      id: "upstreams",
      label: "Target",
      render: (host: ProxyHost) => (
        <p className="text-sm text-muted-foreground font-mono">
          {host.upstreams[0]}
          {host.upstreams.length > 1 && ` +${host.upstreams.length - 1} more`}
        </p>
      )
    },
    {
      id: "actions",
      label: "Actions",
      align: "right" as const,
      width: 150,
      render: (host: ProxyHost) => (
        <div className="flex items-center gap-1 justify-end">
          <Switch
            checked={host.enabled}
            onCheckedChange={(checked) => handleToggleEnabled(host.id, checked)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-blue-400"
                onClick={() => {
                  setDuplicateHost(host);
                  setCreateOpen(true);
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditHost(host)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => setDeleteHost(host)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      )
    }
  ];

  const mobileCard = (host: ProxyHost) => (
    <Card className="p-4">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <p className="text-sm font-bold">{host.name}</p>
          <div className="flex items-center gap-0.5">
            <Switch
              checked={host.enabled}
              onCheckedChange={(checked) => handleToggleEnabled(host.id, checked)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-blue-400"
                  onClick={() => { setDuplicateHost(host); setCreateOpen(true); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Edit"
                  onClick={() => setEditHost(host)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  aria-label="Delete"
                  onClick={() => setDeleteHost(host)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          {host.domains[0]}{host.domains.length > 1 ? ` +${host.domains.length - 1}` : ""} → {host.upstreams[0]}{host.upstreams.length > 1 ? ` +${host.upstreams.length - 1}` : ""}
        </p>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Proxy Hosts"
        description="Define HTTP(S) reverse proxies orchestrated by Caddy with automated certificates."
        action={{
          label: "Create Host",
          onClick: () => setCreateOpen(true)
        }}
      />

      <SearchField
        value={searchTerm}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search hosts..."
      />

      <DataTable
        columns={columns}
        data={hosts}
        keyField="id"
        emptyMessage={searchTerm ? "No hosts match your search" : "No proxy hosts found"}
        pagination={pagination}
        mobileCard={mobileCard}
      />

      <CreateHostDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          // Clear duplicate host after dialog transition
          setTimeout(() => setDuplicateHost(null), 200);
        }}
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
