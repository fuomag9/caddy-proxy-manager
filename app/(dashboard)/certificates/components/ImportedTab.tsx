"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/DataTable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, MoreVertical, Plus } from "lucide-react";
import { useState, useTransition } from "react";
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
    <div className="flex flex-wrap gap-1">
      {visible.map((d) => (
        <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs cursor-default">+{rest.length} more</Badge>
          </TooltipTrigger>
          <TooltipContent>{rest.join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ActionsMenu({ cert, onEdit }: { cert: ImportedCertView; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteCertificateAction(cert.id);
      setOpen(false);
    });
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConfirmDelete(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => { setOpen(false); onEdit(); }}>Edit</DropdownMenuItem>
        {confirmDelete ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "Deleting..." : "Confirm Delete"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function importedMobileCard(c: ImportedCertView, onEdit: () => void) {
  return (
    <Card className="border">
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{c.name}</span>
          <ActionsMenu cert={c} onEdit={onEdit} />
        </div>
        <p className="text-xs text-muted-foreground">
          {c.domains.slice(0, 2).join(", ")}{c.domains.length > 2 ? ` +${c.domains.length - 2} more` : ""}
        </p>
        <RelativeTime validTo={c.validTo} status={c.expiryStatus} />
      </CardContent>
    </Card>
  );
}

export function ImportedTab({ importedCerts, managedCerts, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<ImportedCertView | null | false>(false);
  const mobileCardRenderer = (c: ImportedCertView) => importedMobileCard(c, () => setDrawerCert(c));

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
      render: (c: ImportedCertView) => <span className="font-semibold">{c.name}</span>,
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
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {c.usedBy.map((h) => (
              <Badge key={h.id} variant="outline" className="text-xs">{h.name}</Badge>
            ))}
          </div>
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
    <div className="flex flex-col gap-4">
      {/* Add button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setDrawerCert(null)}>
          <Plus className="h-4 w-4 mr-2" />
          Import Certificate
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage="No imported certificates match"
        mobileCard={mobileCardRenderer}
      />

      {/* Legacy managed certs */}
      {managedCerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <Alert variant="destructive" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Legacy &quot;managed&quot; certificate entries detected. These are redundant — Caddy handles
              HTTPS automatically. Consider deleting them.
            </AlertDescription>
          </Alert>
          <LegacyManagedTable managedCerts={managedCerts} />
        </div>
      )}

      <ImportCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
    </div>
  );
}

function LegacyManagedTable({ managedCerts }: { managedCerts: ManagedCertView[] }) {
  const [isPending, startTransition] = useTransition();

  const columns = [
    {
      id: "name",
      label: "Name",
      render: (c: ManagedCertView) => (
        <span className="text-sm font-semibold">{c.name}</span>
      ),
    },
    {
      id: "domains",
      label: "Domains",
      render: (c: ManagedCertView) => (
        <p className="text-sm text-muted-foreground">{c.domain_names.join(", ")}</p>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right" as const,
      render: (c: ManagedCertView) => (
        <Button
          size="sm"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
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
