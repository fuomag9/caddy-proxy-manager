"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, Chip, IconButton, Stack, Switch, Tooltip, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { L4ProxyHost } from "@/src/lib/models/l4-proxy-hosts";
import { toggleL4ProxyHostAction } from "./actions";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SearchField } from "@/src/components/ui/SearchField";
import { DataTable } from "@/src/components/ui/DataTable";
import { CreateL4HostDialog, EditL4HostDialog, DeleteL4HostDialog } from "@/src/components/l4-proxy-hosts/L4HostDialogs";
import { L4PortsApplyBanner } from "@/src/components/l4-proxy-hosts/L4PortsApplyBanner";

type Props = {
  hosts: L4ProxyHost[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

function formatMatcher(host: L4ProxyHost): string {
  switch (host.matcher_type) {
    case "tls_sni":
      return `SNI: ${host.matcher_value.join(", ")}`;
    case "http_host":
      return `Host: ${host.matcher_value.join(", ")}`;
    case "proxy_protocol":
      return "Proxy Protocol";
    default:
      return "None";
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
    await toggleL4ProxyHostAction(id, enabled);
    signalBannerRefresh();
  };

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (host: L4ProxyHost) => (
        <Typography variant="body2" fontWeight={600}>
          {host.name}
        </Typography>
      ),
    },
    {
      id: "protocol",
      label: "Protocol",
      width: 80,
      render: (host: L4ProxyHost) => (
        <Chip
          label={host.protocol.toUpperCase()}
          size="small"
          color={host.protocol === "tcp" ? "primary" : "secondary"}
          variant="outlined"
        />
      ),
    },
    {
      id: "listen",
      label: "Listen",
      render: (host: L4ProxyHost) => (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {host.listen_address}
        </Typography>
      ),
    },
    {
      id: "matcher",
      label: "Matcher",
      render: (host: L4ProxyHost) => (
        <Typography variant="body2" color="text.secondary">
          {formatMatcher(host)}
        </Typography>
      ),
    },
    {
      id: "upstreams",
      label: "Upstreams",
      render: (host: L4ProxyHost) => (
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {host.upstreams[0]}
          {host.upstreams.length > 1 && ` +${host.upstreams.length - 1} more`}
        </Typography>
      ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right" as const,
      width: 150,
      render: (host: L4ProxyHost) => (
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
      ),
    },
  ];

  const mobileCard = (host: L4ProxyHost) => (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2" fontWeight={700}>
              {host.name}
            </Typography>
            <Chip
              label={host.protocol.toUpperCase()}
              size="small"
              color={host.protocol === "tcp" ? "primary" : "secondary"}
              variant="outlined"
            />
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
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
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
          {host.listen_address} {"\u2192"} {host.upstreams[0]}
          {host.upstreams.length > 1 ? ` +${host.upstreams.length - 1}` : ""}
        </Typography>
      </Stack>
    </Card>
  );

  return (
    <Stack spacing={4}>
      <L4PortsApplyBanner refreshSignal={bannerRefresh} />
      <PageHeader
        title="L4 Proxy Hosts"
        description="Define TCP/UDP stream proxies powered by caddy-l4. Port mappings are applied automatically by the L4 port manager."
        action={{
          label: "Create L4 Host",
          onClick: () => setCreateOpen(true),
        }}
      />

      <SearchField
        value={searchTerm}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search L4 hosts..."
      />

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
        onClose={() => {
          setCreateOpen(false);
          setTimeout(() => setDuplicateHost(null), 200);
          signalBannerRefresh();
        }}
        initialData={duplicateHost}
      />

      {editHost && (
        <EditL4HostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => {
            setEditHost(null);
            signalBannerRefresh();
          }}
        />
      )}

      {deleteHost && (
        <DeleteL4HostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => {
            setDeleteHost(null);
            signalBannerRefresh();
          }}
        />
      )}
    </Stack>
  );
}
