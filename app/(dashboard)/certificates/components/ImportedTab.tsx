"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useState, useTransition } from "react";
import { DataTable } from "@/src/components/ui/DataTable";
import { deleteCertificateAction } from "../actions";
import type { ImportedCertView, ManagedCertView } from "../page";
import { RelativeTime } from "./RelativeTime";
import { ImportCertDrawer } from "./ImportCertDrawer";

type Props = {
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  search: string;
  statusFilter: string | null;
};

function DomainsCell({ domains }: { domains: string[] }) {
  const visible = domains.slice(0, 2);
  const rest = domains.slice(2);
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap">
      {visible.map((d) => (
        <Chip key={d} label={d} size="small" variant="outlined" />
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.join(", ")}>
          <Chip label={`+${rest.length} more`} size="small" />
        </Tooltip>
      )}
    </Stack>
  );
}

function ActionsMenu({ cert, onEdit }: { cert: ImportedCertView; onEdit: () => void }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteCertificateAction(cert.id);
      setAnchor(null);
    });
  }

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => { setAnchor(null); setConfirmDelete(false); }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={() => { setAnchor(null); onEdit(); }}>Edit</MenuItem>
        {confirmDelete ? (
          <MenuItem
            sx={{ color: "error.main" }}
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "Deleting..." : "Confirm Delete"}
          </MenuItem>
        ) : (
          <MenuItem sx={{ color: "error.main" }} onClick={() => setConfirmDelete(true)}>
            Delete
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

export function ImportedTab({ importedCerts, managedCerts, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<ImportedCertView | null | false>(false);

  const filtered = importedCerts.filter((c) => {
    if (statusFilter && c.expiryStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (c: ImportedCertView) => <Typography fontWeight={600}>{c.name}</Typography>,
    },
    {
      id: "domains",
      label: "Domains",
      render: (c: ImportedCertView) => <DomainsCell domains={c.domains} />,
    },
    {
      id: "expiry",
      label: "Expires",
      render: (c: ImportedCertView) => <RelativeTime validTo={c.validTo} status={c.expiryStatus} />,
    },
    {
      id: "usedBy",
      label: "Used by",
      render: (c: ImportedCertView) =>
        c.usedBy.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {c.usedBy.map((h) => (
              <Chip key={h.id} label={h.name} size="small" variant="outlined" />
            ))}
          </Stack>
        ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      render: (c: ImportedCertView) => (
        <ActionsMenu cert={c} onEdit={() => setDrawerCert(c)} />
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      {/* Add button */}
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          size="small"
          onClick={() => setDrawerCert(null)}
        >
          Import Certificate
        </Button>
      </Box>

      <DataTable
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage="No imported certificates match"
      />

      {/* Legacy managed certs */}
      {managedCerts.length > 0 && (
        <Stack spacing={1}>
          <Alert severity="warning">
            Legacy &quot;managed&quot; certificate entries detected. These are redundant — Caddy handles
            HTTPS automatically. Consider deleting them.
          </Alert>
          <LegacyManagedTable managedCerts={managedCerts} />
        </Stack>
      )}

      <ImportCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
    </Stack>
  );
}

function LegacyManagedTable({ managedCerts }: { managedCerts: ManagedCertView[] }) {
  const [isPending, startTransition] = useTransition();

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (c: ManagedCertView) => (
        <Typography variant="body2" fontWeight={600}>
          {c.name}
        </Typography>
      ),
    },
    {
      id: "domains",
      label: "Domains",
      render: (c: ManagedCertView) => (
        <Typography variant="body2" color="text.secondary">
          {c.domain_names.join(", ")}
        </Typography>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      render: (c: ManagedCertView) => (
        <Button
          size="small"
          variant="outlined"
          color="error"
          disabled={isPending}
          onClick={() => startTransition(async () => { await deleteCertificateAction(c.id); })}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={managedCerts}
      keyField="id"
      emptyMessage="No legacy managed certificates"
    />
  );
}
