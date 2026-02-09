"use client";

import { useMemo, useState } from "react";
import { IconButton, Stack, Switch, Tooltip, Typography } from "@mui/material";
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
};

export default function ProxyHostsClient({ hosts, certificates, accessLists, authentikDefaults }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateHost, setDuplicateHost] = useState<ProxyHost | null>(null);
  const [editHost, setEditHost] = useState<ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<ProxyHost | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredHosts = useMemo(() => {
    if (!searchTerm.trim()) return hosts;

    const search = searchTerm.toLowerCase();
    return hosts.filter((host) => {
      // Search in name
      if (host.name.toLowerCase().includes(search)) return true;
      // Search in domains
      if (host.domains.some(domain => domain.toLowerCase().includes(search))) return true;
      // Search in upstreams
      if (host.upstreams.some(upstream => upstream.toLowerCase().includes(search))) return true;

      const certificate = host.certificate_id
        ? certificates.find(c => c.id === host.certificate_id)
        : null;
      const certName = certificate?.name ?? "Managed by Caddy (Auto)";
      if (certName.toLowerCase().includes(search)) return true;

      return false;
    });
  }, [hosts, certificates, searchTerm]);

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
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search hosts..."
      />

      <DataTable
        columns={columns}
        data={filteredHosts}
        keyField="id"
        emptyMessage={searchTerm ? "No hosts match your search" : "No proxy hosts found"}
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
