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
import { ChevronDown, ChevronUp, MoreVertical, Plus } from "lucide-react";
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
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function IssuedCertsPanel({ ca }: { ca: CaCertificateView }) {
  const [issueCaOpen, setIssueCaOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const active = ca.issuedCerts.filter((c) => !c.revoked_at);

  return (
    <div className="p-4 bg-muted/40">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            Issued Client Certificates ({active.length} active)
          </span>
          <div className="flex gap-2">
            {ca.has_private_key && (
              <Button size="sm" variant="outline" onClick={() => setIssueCaOpen(true)}>
                Issue Cert
              </Button>
            )}
            {ca.issuedCerts.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
                Manage
              </Button>
            )}
          </div>
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active client certificates for this CA.</p>
        ) : (
          <>
            {active.slice(0, 5).map((issued) => {
              const expired = new Date(issued.valid_to).getTime() < Date.now();
              return (
                <div key={issued.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-mono">{issued.common_name}</span>
                  <Badge variant={expired ? "destructive" : "default"}>
                    {expired ? "Expired" : "Active"}
                  </Badge>
                </div>
              );
            })}
            {active.length > 5 && (
              <p className="text-sm text-muted-foreground">
                +{active.length - 5} more — click &quot;Manage&quot; to view all
              </p>
            )}
          </>
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
          {ca.has_private_key && (
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
    // CA certs have no expiry status so if filtering by expiry, hide them
    if (statusFilter) return false;
    if (search) return ca.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setDrawerCert(null)}>
          <Plus className="h-4 w-4 mr-2" />
          Add CA Certificate
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden flex flex-col gap-3">
        {filtered.length === 0 ? (
          <Card className="border">
            <CardContent className="py-10 text-center">
              <p className="text-muted-foreground">
                {search || statusFilter ? "No CA certificates match" : "No CA certificates configured."}
              </p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ca) => {
            const activeCount = ca.issuedCerts.filter((c) => !c.revoked_at).length;
            return (
              <Card key={ca.id} className="border">
                <CardContent className="p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{ca.name}</span>
                    <CaActionsMenu ca={ca} onEdit={() => setDrawerCert(ca)} onDelete={() => setDeleteCert(ca)} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ca.has_private_key && (
                      <Badge variant="outline" className="border-green-600 text-green-600 dark:text-green-400">Key stored</Badge>
                    )}
                    {ca.issuedCerts.length > 0 && (
                      <Badge variant="outline" className={activeCount > 0 ? "border-green-600 text-green-600 dark:text-green-400" : ""}>
                        {activeCount}/{ca.issuedCerts.length} active
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{formatRelativeDate(ca.created_at)}</span>
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
                const activeCount = ca.issuedCerts.filter((c) => !c.revoked_at).length;
                const expanded = expandedId === ca.id;
                return (
                  <React.Fragment key={ca.id}>
                    <TableRow>
                      <TableCell className="pr-0 w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setExpandedId(expanded ? null : ca.id)}
                        >
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{ca.name}</span>
                      </TableCell>
                      <TableCell>
                        {ca.has_private_key ? (
                          <Badge variant="outline" className="border-green-600 text-green-600 dark:text-green-400">Stored</Badge>
                        ) : (
                          <p className="text-sm text-muted-foreground">—</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {ca.issuedCerts.length === 0 ? (
                          <p className="text-sm text-muted-foreground">None</p>
                        ) : (
                          <Badge variant="outline" className={activeCount > 0 ? "border-green-600 text-green-600 dark:text-green-400" : ""}>
                            {activeCount}/{ca.issuedCerts.length} active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{formatRelativeDate(ca.created_at)}</p>
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
