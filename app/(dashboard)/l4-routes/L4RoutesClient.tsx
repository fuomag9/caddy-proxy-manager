"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, Chip, IconButton, Stack, Switch, Tooltip, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { L4Route } from "@/src/lib/models/l4-routes";
import type { Certificate } from "@/src/lib/models/certificates";
import { toggleL4RouteAction } from "./actions";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SearchField } from "@/src/components/ui/SearchField";
import { DataTable } from "@/src/components/ui/DataTable";
import { CreateL4RouteDialog, EditL4RouteDialog, DeleteL4RouteDialog } from "@/src/components/l4-routes/L4RouteDialogs";

type Props = {
  routes: L4Route[];
  certificates: Certificate[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
};

export default function L4RoutesClient({ routes, certificates, pagination, initialSearch }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateRoute, setDuplicateRoute] = useState<L4Route | null>(null);
  const [editRoute, setEditRoute] = useState<L4Route | null>(null);
  const [deleteRoute, setDeleteRoute] = useState<L4Route | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearch);

  const router = useRouter();  const pathname = usePathname();
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
    await toggleL4RouteAction(id, enabled);
  };

  const handlerTypeLabel: Record<string, string> = {
    proxy: "Proxy",
    echo: "Echo",
    close: "Close",
    socks5: "SOCKS5",
  };

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (route: L4Route) => (
        <Stack>
          <Typography variant="body2" fontWeight={600}>
            {route.name}
          </Typography>
        </Stack>
      ),
    },
    {
      id: "listen",
      label: "Listen",
      render: (route: L4Route) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {route.listen_addresses.map((addr) => (
            <Chip key={addr} label={addr} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }} />
          ))}
        </Stack>
      ),
    },
    {
      id: "handler",
      label: "Handler",
      width: 100,
      render: (route: L4Route) => (
        <Chip label={handlerTypeLabel[route.handler_type] ?? route.handler_type} size="small" color="primary" variant="outlined" />
      ),
    },
    {
      id: "upstreams",
      label: "Upstreams",
      render: (route: L4Route) => {
        if (!route.upstreams || route.upstreams.length === 0) {
          return <Typography variant="body2" color="text.secondary">—</Typography>;
        }
        const first = route.upstreams[0].dial?.[0] ?? "—";
        return (
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {first}
            {route.upstreams.length > 1 && ` +${route.upstreams.length - 1} more`}
          </Typography>
        );
      },
    },
    {
      id: "features",
      label: "Features",
      render: (route: L4Route) => {
        const chips: React.ReactNode[] = [];
        if (route.tls_termination) chips.push(<Chip key="tls" label="TLS" size="small" variant="outlined" color="info" />);
        if (route.proxy_protocol) chips.push(<Chip key="pp" label={`PP ${route.proxy_protocol}`} size="small" variant="outlined" color="secondary" />);
        if (route.meta?.load_balancing?.policy) chips.push(<Chip key="lb" label={route.meta.load_balancing.policy.replace("_", " ")} size="small" variant="outlined" />);
        if (route.meta?.health_check) chips.push(<Chip key="hc" label="Health Check" size="small" variant="outlined" color="success" />);
        if (route.meta?.throttle) chips.push(<Chip key="thr" label="Throttle" size="small" variant="outlined" color="warning" />);
        if (chips.length === 0) return <Typography variant="body2" color="text.secondary">—</Typography>;
        return <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{chips}</Stack>;
      },
    },
    {
      id: "actions",
      label: "Actions",
      align: "right" as const,
      width: 150,
      render: (route: L4Route) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          <Switch
            checked={route.enabled}
            onChange={(e) => handleToggleEnabled(route.id, e.target.checked)}
            size="small"
            color="success"
          />
          <Tooltip title="Duplicate">
            <IconButton
              size="small"
              onClick={() => {
                setDuplicateRoute(route);
                setCreateOpen(true);
              }}
              color="info"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => setEditRoute(route)} color="primary">
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => setDeleteRoute(route)} color="error">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const mobileCard = (route: L4Route) => (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" fontWeight={700}>
            {route.name}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Switch
              checked={route.enabled}
              onChange={(e) => handleToggleEnabled(route.id, e.target.checked)}
              size="small"
              color="success"
            />
            <Tooltip title="Duplicate">
              <IconButton
                size="small"
                onClick={() => {
                  setDuplicateRoute(route);
                  setCreateOpen(true);
                }}
                color="info"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => setEditRoute(route)} color="primary">
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => setDeleteRoute(route)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
          {route.listen_addresses.join(", ")} → {route.upstreams?.[0]?.dial?.[0] ?? route.handler_type}
        </Typography>
      </Stack>
    </Card>
  );

  return (
    <Stack spacing={4}>
      <PageHeader
        title="L4 Routes"
        description="Define TCP/UDP layer 4 proxies orchestrated by Caddy with protocol-aware routing."
        action={{
          label: "Create L4 Route",
          onClick: () => setCreateOpen(true),
        }}
      />

      <SearchField
        id="l4-routes-search"
        value={searchTerm}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search L4 routes..."
      />

      <DataTable
        columns={columns}
        data={routes}
        keyField="id"
        emptyMessage={searchTerm ? "No L4 routes match your search" : "No L4 routes found"}
        pagination={pagination}
        mobileCard={mobileCard}
      />

      <CreateL4RouteDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setTimeout(() => setDuplicateRoute(null), 200);
          router.refresh();
        }}
        initialData={duplicateRoute}
        certificates={certificates}
      />

      {editRoute && (
        <EditL4RouteDialog
          open={!!editRoute}
          route={editRoute}
          onClose={() => {
            setEditRoute(null);
            router.refresh();
          }}
          certificates={certificates}
        />
      )}

      {deleteRoute && (
        <DeleteL4RouteDialog
          open={!!deleteRoute}
          route={deleteRoute}
          onClose={() => {
            setDeleteRoute(null);
            router.refresh();
          }}
        />
      )}
    </Stack>
  );
}
