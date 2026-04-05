"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, Plus, UserPlus } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { MtlsRole, MtlsRoleWithCertificates } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";

const ACCENT_COLORS = [
  { border: "border-l-amber-500", icon: "border-amber-500/30 bg-amber-500/10 text-amber-500", badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400", avatar: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { border: "border-l-cyan-500", icon: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500", badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", avatar: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  { border: "border-l-violet-500", icon: "border-violet-500/30 bg-violet-500/10 text-violet-500", badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400", avatar: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  { border: "border-l-emerald-500", icon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", avatar: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  { border: "border-l-rose-500", icon: "border-rose-500/30 bg-rose-500/10 text-rose-500", badge: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400", avatar: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
];

type Props = {
  roles: MtlsRole[];
  issuedCerts: IssuedClientCertificate[];
  search: string;
};

export function MtlsRolesTab({ roles, issuedCerts, search }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const activeCerts = issuedCerts.filter(c => !c.revoked_at);

  const filtered = roles.filter(r =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Create inline form */}
      {createOpen ? (
        <CreateRoleCard onClose={() => setCreateOpen(false)} />
      ) : (
        <Button variant="outline" className="w-full border-dashed gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create New Role
        </Button>
      )}

      {filtered.length === 0 && !createOpen && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search ? "No roles match your search." : "No mTLS roles yet."}
          </p>
          <p className="text-xs text-muted-foreground">
            Roles group client certificates for access control on proxy hosts.
          </p>
        </div>
      )}

      {filtered.map((role, idx) => (
        <RoleCard key={role.id} role={role} accent={ACCENT_COLORS[idx % ACCENT_COLORS.length]} activeCerts={activeCerts} />
      ))}
    </div>
  );
}

/* ── Create role inline card ── */

function CreateRoleCard({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/v1/mtls-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `Failed (${res.status})`); setSubmitting(false); return; }
      onClose();
      window.location.reload();
    } catch { setError("Network error"); setSubmitting(false); }
  }

  return (
    <Card className="border-l-2 border-l-primary">
      <CardContent className="pt-5 pb-4 px-5 flex flex-col gap-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. admin" className="h-8 text-sm" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating..." : "Create Role"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Single role card ── */

function RoleCard({ role, accent, activeCerts }: { role: MtlsRole; accent: typeof ACCENT_COLORS[0]; activeCerts: IssuedClientCertificate[] }) {
  const [assignedIds, setAssignedIds] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");

  const loadAssignments = useCallback(() => {
    fetch(`/api/v1/mtls-roles/${role.id}`)
      .then(r => r.ok ? r.json() : { certificate_ids: [] })
      .then((data: MtlsRoleWithCertificates) => { setAssignedIds(new Set(data.certificate_ids)); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [role.id]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  async function handleToggle(certId: number) {
    const isAssigned = assignedIds.has(certId);
    setToggling(certId);
    try {
      if (isAssigned) {
        await fetch(`/api/v1/mtls-roles/${role.id}/certificates/${certId}`, { method: "DELETE" });
        setAssignedIds(prev => { const next = new Set(prev); next.delete(certId); return next; });
      } else {
        await fetch(`/api/v1/mtls-roles/${role.id}/certificates`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certificate_id: certId }),
        });
        setAssignedIds(prev => new Set(prev).add(certId));
      }
    } catch { /* silent */ }
    setToggling(null);
  }

  async function handleSave() {
    await fetch(`/api/v1/mtls-roles/${role.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    });
    setEditing(false);
    window.location.reload();
  }

  async function handleDelete() {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    await fetch(`/api/v1/mtls-roles/${role.id}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <Card className={`border-l-2 ${accent.border}`}>
      <CardContent className="flex flex-col gap-4 pt-5 pb-5 px-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.icon}`}>
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{role.name}</p>
            <p className="text-xs text-muted-foreground">
              {assignedIds.size} {assignedIds.size === 1 ? "certificate" : "certificates"}
              {role.description && ` · ${role.description}`}
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${accent.badge}`}>
            {assignedIds.size}
          </span>
        </div>

        {/* Edit form */}
        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Description</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} className="h-8 text-sm" placeholder="Optional" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSave}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={handleDelete}>Delete role</Button>
          </div>
        )}

        <Separator />

        {/* Certificates */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Certificates</p>

          {!loaded ? (
            <p className="text-sm text-muted-foreground py-2">Loading...</p>
          ) : activeCerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
              <UserPlus className="h-4 w-4 shrink-0" />
              No client certificates issued yet.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-md border overflow-hidden">
              {activeCerts.map(cert => {
                const isAssigned = assignedIds.has(cert.id);
                const isLoading = toggling === cert.id;
                return (
                  <div key={cert.id} className={`flex items-center justify-between px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors ${isLoading ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2.5">
                      <Checkbox checked={isAssigned} disabled={isLoading} onCheckedChange={() => handleToggle(cert.id)} />
                      <div>
                        <p className="text-sm font-medium leading-tight">{cert.common_name}</p>
                        <p className="text-xs text-muted-foreground">
                          expires {new Date(cert.valid_to).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {isAssigned && <Badge variant="secondary" className="text-xs">Assigned</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
