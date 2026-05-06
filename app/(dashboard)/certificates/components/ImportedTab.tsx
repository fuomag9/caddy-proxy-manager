"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AppDialog } from "@/components/ui/AppDialog";
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
import { AlertTriangle, FileKey, MoreVertical, Plus } from "lucide-react";
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
        <Badge key={d} variant="info" className="text-[10px] px-1.5 py-0 font-mono">{d}</Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 cursor-default">+{rest.length}</Badge>
          </TooltipTrigger>
          <TooltipContent>{rest.join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ActionsMenu({ cert, onEdit }: { cert: ImportedCertView; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCertificateAction(cert.id);
        setDeleteOpen(false);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete certificate");
      }
    });
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Actions for certificate ${cert.name}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setOpen(false); onEdit(); }}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              setOpen(false);
              setError(null);
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AppDialog
        open={deleteOpen}
        onClose={() => {
          if (isPending) return;
          setDeleteOpen(false);
          setError(null);
        }}
        title="Delete Imported Certificate"
        maxWidth="sm"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setError(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete Certificate"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Delete imported certificate <strong className="text-foreground">{cert.name}</strong>? This cannot be undone.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </AppDialog>
    </>
  );
}

function importedMobileCard(c: ImportedCertView, onEdit: () => void) {
  return (
    <Card className={[
      "border-l-2",
      c.expiryStatus === "expired" ? "border-l-rose-500"
        : c.expiryStatus === "expiring_soon" ? "border-l-amber-500"
        : "border-l-emerald-500",
    ].join(" ")}>
      <CardContent className="p-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
              <FileKey className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">{c.name}</span>
          </div>
          <ActionsMenu cert={c} onEdit={onEdit} />
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          {c.domains.slice(0, 2).join(", ")}{c.domains.length > 2 ? ` +${c.domains.length - 2}` : ""}
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
      render: (c: ImportedCertView) => (
        <div className="flex items-start gap-3">
          <div className={[
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            c.expiryStatus === "expired"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
              : c.expiryStatus === "expiring_soon"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
          ].join(" ")}>
            <FileKey className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold">{c.name}</span>
        </div>
      ),
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
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {c.usedBy.map((h) => (
              <Badge key={h.id} variant="secondary" className="text-[10px] px-1.5 py-0">{h.name}</Badge>
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
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setDrawerCert(null)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Import Certificate
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage="No imported certificates match"
        mobileCard={mobileCardRenderer}
        rowClassName={(c) =>
          c.expiryStatus === "expired" ? "opacity-70"
            : c.expiryStatus === "expiring_soon" ? "bg-amber-500/5"
            : ""
        }
      />

      {managedCerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400">
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
        <p className="text-sm text-muted-foreground font-mono">{c.domainNames.join(", ")}</p>
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
          className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
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
