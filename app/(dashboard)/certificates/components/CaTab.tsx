"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronUp, KeyRound, MoreVertical, Plus, ShieldCheck } from "lucide-react";
import React, { useState } from "react";
import {
  DeleteCaCertDialog,
  IssueClientCertDialog,
  ManageIssuedClientCertsDialog,
} from "@/components/ca-certificates/CaCertDialogs";
import type { CaCertificateView } from "../page";
import { CaCertDrawer } from "./CaCertDrawer";

type Props = {
  caCertificates: CaCertificateView[];
  search: string;
  statusFilter: string | null;
};

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function IssuedCertsPanel({ ca }: { ca: CaCertificateView }) {
  const [issueCaOpen, setIssueCaOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const active = ca.issuedCerts.filter((c) => !c.revokedAt);

  return (
    <div className="px-5 py-4 bg-muted/30 border-t">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Issued Client Certificates
            <span className="ml-2 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {active.length} active
            </span>
          </span>
          <div className="flex gap-2">
            {ca.hasPrivateKey && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIssueCaOpen(true)}>
                Issue Cert
              </Button>
            )}
            {ca.issuedCerts.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManageOpen(true)}>
                Manage
              </Button>
            )}
          </div>
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active client certificates for this CA.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border overflow-hidden">
            {active.slice(0, 5).map((issued) => {
              const expired = new Date(issued.validTo).getTime() < Date.now();
              return (
                <div key={issued.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-background/60">
                  <span className="text-sm font-mono">{issued.commonName}</span>
                  <Badge variant={expired ? "destructive" : "success"} className="text-[10px] px-1.5 py-0">
                    {expired ? "Expired" : "Active"}
                  </Badge>
                </div>
              );
            })}
            {active.length > 5 && (
              <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30">
                +{active.length - 5} more — click &quot;Manage&quot; to view all
              </div>
            )}
          </div>
        )}
      </div>

      <ManageIssuedClientCertsDialog
        open={manageOpen}
        cert={ca}
        issuedCerts={ca.issuedCerts}
        onClose={() => setManageOpen(false)}
      />
      <IssueClientCertDialog
        open={issueCaOpen}
        cert={ca}
        onClose={() => setIssueCaOpen(false)}
      />
    </div>
  );
}

function CaActionsMenu({
  ca,
  onEdit,
  onDelete,
}: {
  ca: CaCertificateView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [issuedOpen, setIssuedOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ca.hasPrivateKey && (
            <DropdownMenuItem onClick={() => { setOpen(false); setIssuedOpen(true); }}>
              Issue Client Cert
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => { setOpen(false); onEdit(); }}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => { setOpen(false); onDelete(); }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IssueClientCertDialog open={issuedOpen} cert={ca} onClose={() => setIssuedOpen(false)} />
    </>
  );
}

export function CaTab({ caCertificates, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<CaCertificateView | null | false>(false);
  const [deleteCert, setDeleteCert] = useState<CaCertificateView | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = caCertificates.filter((ca) => {
    if (statusFilter) return false;
    if (search) return ca.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setDrawerCert(null)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add CA Certificate
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden flex flex-col gap-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-muted-foreground">
                {search || statusFilter ? "No CA certificates match" : "No CA certificates configured."}
              </p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ca) => {
            const activeCount = ca.issuedCerts.filter((c) => !c.revokedAt).length;
            return (
              <Card key={ca.id} className="border-l-2 border-l-violet-500">
                <CardContent className="p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-500">
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-sm font-semibold">{ca.name}</span>
                    </div>
                    <CaActionsMenu ca={ca} onEdit={() => setDrawerCert(ca)} onDelete={() => setDeleteCert(ca)} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ca.hasPrivateKey && (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">
                        <KeyRound className="h-2.5 w-2.5 mr-0.5" />Key stored
                      </Badge>
                    )}
                    {ca.issuedCerts.length > 0 && (
                      <Badge variant={activeCount > 0 ? "info" : "secondary"} className="text-[10px] px-1.5 py-0">
                        {activeCount}/{ca.issuedCerts.length} active
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{formatRelativeDate(ca.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border overflow-x-auto">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Name</TableHead>
              <TableHead>Private Key</TableHead>
              <TableHead>Issued Certs</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {search || statusFilter ? "No CA certificates match" : "No CA certificates configured."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ca) => {
                const activeCount = ca.issuedCerts.filter((c) => !c.revokedAt).length;
                const expanded = expandedId === ca.id;
                return (
                  <React.Fragment key={ca.id}>
                    <TableRow className={expanded ? "bg-muted/20" : ""}>
                      <TableCell className="pr-0 w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setExpandedId(expanded ? null : ca.id)}
                        >
                          {expanded
                            ? <ChevronUp className="h-4 w-4" />
                            : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-500">
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-sm font-semibold">{ca.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {ca.hasPrivateKey ? (
                          <Badge variant="success" className="text-[10px] px-1.5 py-0">
                            <KeyRound className="h-2.5 w-2.5 mr-0.5" />Stored
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ca.issuedCerts.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          <Badge variant={activeCount > 0 ? "info" : "secondary"} className="text-[10px] px-1.5 py-0">
                            {activeCount}/{ca.issuedCerts.length} active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{formatRelativeDate(ca.createdAt)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <CaActionsMenu
                          ca={ca}
                          onEdit={() => setDrawerCert(ca)}
                          onDelete={() => setDeleteCert(ca)}
                        />
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <IssuedCertsPanel ca={ca} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CaCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
      {deleteCert && (
        <DeleteCaCertDialog
          open={!!deleteCert}
          cert={deleteCert}
          onClose={() => setDeleteCert(null)}
        />
      )}
    </div>
  );
}
