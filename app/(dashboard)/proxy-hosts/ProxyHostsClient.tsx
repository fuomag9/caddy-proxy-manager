"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Chip, IconButton, Stack, Switch, Tooltip, Typography } from "@mui/material";
import SecurityIcon from "@mui/icons-material/Security";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { AccessList } from "@/src/lib/models/access-lists";
import type { Certificate } from "@/src/lib/models/certificates";
import type { ProxyHost } from "@/src/lib/models/proxy-hosts";
import type { AuthentikSettings } from "@/src/lib/settings";
import { toggleProxyHostAction } from "./actions";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SearchField } from "@/src/components/ui/SearchField";
import { DataTable } from "@/src/components/ui/DataTable";
import { StatusChip } from "@/src/components/ui/StatusChip";
import { CreateHostDialog, EditHostDialog, DeleteHostDialog } from "@/src/components/proxy-hosts/HostDialogs";

type Props = {
  hosts: ProxyHost[];
  certificates: Certificate[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings | null;
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function ProxyHostsClient({ hosts, certificates, accessLists, authentikDefaults, pagination, initialSearch }: Props) {
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
        <Stack>
          <Typography variant="body2" fontWeight={600}>
            {host.name}
          </Typography>
        </Stack>
      )
    },
    {
      id: "domains",
      label: "Domains",
      render: (host: ProxyHost) => (
        <Stack>
          <Typography variant="body2" color="text.secondary">
            {host.domains[0]}
            {host.domains.length > 1 && ` +${host.domains.length - 1} more`}
          </Typography>
        </Stack>
      )
    },
    {
      id: "upstreams",
      label: "Target",
      render: (host: ProxyHost) => (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {host.upstreams[0]}
          {host.upstreams.length > 1 && ` +${host.upstreams.length - 1} more`}
        </Typography>
      )
    },
    {
      id: "waf",
      label: "WAF",
      render: (host: ProxyHost) => {
        if (!host.waf?.enabled) return <Typography variant="body2" color="text.disabled">—</Typography>;
        const excludedCount = host.waf.excluded_rule_ids?.length ?? 0;
        return (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <SecurityIcon sx={{ fontSize: 16, color: 'success.light' }} />
            {excludedCount > 0 && (
              <Chip
                label={`${excludedCount} suppressed`}
                size="small"
                sx={{ fontSize: 11, height: 20 }}
              />
            )}
          </Stack>
        );
      }
    },
    {
      id: "status",
      label: "Status",
      render: (host: ProxyHost) => (
        <StatusChip status={host.enabled ? "active" : "inactive"} label={host.enabled ? "Active" : "Paused"} />
      )
    },
    {
      id: "actions",
      label: "Actions",
      align: "right" as const,
      width: 150,
      render: (host: ProxyHost) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          <Switch
            checked={host.enabled}
            onChange={(e) => handleToggleEnabled(host.id, e.target.checked)}
            size="small"
            color="success"
          />
          <Tooltip title="Duplicate">
            <IconButton
              size="small"
              onClick={() => {
                setDuplicateHost(host);
                setCreateOpen(true);
              }}
              color="info"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => setEditHost(host)} color="primary">
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => setDeleteHost(host)} color="error">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ];

  return (
    <Stack spacing={4}>
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
      />

      {editHost && (
        <EditHostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => setEditHost(null)}
          certificates={certificates}
          accessLists={accessLists}
        />
      )}

      {deleteHost && (
        <DeleteHostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => setDeleteHost(null)}
        />
      )}
    </Stack>
  );
}
