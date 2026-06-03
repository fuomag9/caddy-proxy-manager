"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LockKeyhole, Plus, Pencil, Trash2, ShieldAlert, Ban, UserCheck, ShieldCheck } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { MtlsConfig } from "@/lib/models/proxy-hosts";
import type { MtlsAccessRule } from "@/lib/models/mtls-access-rules";
import type { MtlsRole } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";

type Props = {
  value?: MtlsConfig | null;
  caCertificates: CaCertificate[];
  issuedClientCerts?: IssuedClientCertificate[];
  proxyHostId?: number;
  mtlsRoles?: MtlsRole[];
};

export function MtlsFields({ value, caCertificates, issuedClientCerts = [], proxyHostId, mtlsRoles = [] }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [selectedCertIds, setSelectedCertIds] = useState<number[]>(value?.trusted_client_cert_ids ?? []);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>(value?.trusted_role_ids ?? []);

  const [rules, setRules] = useState<MtlsAccessRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [editRule, setEditRule] = useState<MtlsAccessRule | null>(null);

  const isEditMode = !!proxyHostId;
  // Only consider certs that are not revoked AND whose issuing CA still exists.
  // Deleting a CA should remove its issued certs, but legacy/orphaned rows must
  // never resurface as selectable here.
  const knownCaIds = new Set(caCertificates.map(c => c.id));
  const activeCerts = issuedClientCerts.filter(c => !c.revokedAt && knownCaIds.has(c.caCertificateId));

  const certsByCA = new Map<number, IssuedClientCertificate[]>();
  for (const cert of activeCerts) {
    const list = certsByCA.get(cert.caCertificateId) ?? [];
    list.push(cert);
    certsByCA.set(cert.caCertificateId, list);
  }

  const loadRules = useCallback(() => {
    if (!proxyHostId) return;
    fetch(`/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules`)
      .then(r => r.ok ? r.json() : [])
      .then((data: MtlsAccessRule[]) => { setRules(data); setRulesLoaded(true); })
      .catch(() => { setRules([]); setRulesLoaded(true); });
  }, [proxyHostId]);

  useEffect(() => {
    if (isEditMode && enabled) loadRules();
  }, [isEditMode, enabled, loadRules]);

  function toggleCert(certId: number) {
    setSelectedCertIds(prev => prev.includes(certId) ? prev.filter(i => i !== certId) : [...prev, certId]);
  }

  function toggleRole(roleId: number) {
    setSelectedRoleIds(prev => prev.includes(roleId) ? prev.filter(i => i !== roleId) : [...prev, roleId]);
  }

  function toggleAllFromCA(caId: number) {
    const caCerts = certsByCA.get(caId) ?? [];
    const caIds = caCerts.map(c => c.id);
    const allSelected = caIds.every(id => selectedCertIds.includes(id));
    setSelectedCertIds(prev => allSelected ? prev.filter(id => !caIds.includes(id)) : [...new Set([...prev, ...caIds])]);
  }

  async function deleteRule(ruleId: number) {
    try {
      const res = await fetch(`/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules/${ruleId}`, { method: "DELETE" });
      if (res.ok) setRules(prev => prev.filter(r => r.id !== ruleId));
    } catch { /* silent */ }
  }

  const hasTrust = selectedCertIds.length > 0 || selectedRoleIds.length > 0;

  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-4">
      <input type="hidden" name="mtlsPresent" value="1" />
      <input type="hidden" name="mtlsEnabled" value={enabled ? "true" : "false"} />
      {enabled && selectedCertIds.map(id => (
        <input key={`c${id}`} type="hidden" name="mtlsCertId" value={String(id)} />
      ))}
      {enabled && selectedRoleIds.map(id => (
        <input key={`r${id}`} type="hidden" name="mtlsRoleId" value={String(id)} />
      ))}

      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-row items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
            <LockKeyhole className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug">Mutual TLS (mTLS)</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Require clients to present a trusted certificate to connect
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} className="shrink-0" />
      </div>

      <div className={cn(
        "overflow-hidden transition-all duration-200",
        enabled ? "max-h-[4000px] opacity-100 mt-4" : "max-h-0 opacity-0 pointer-events-none"
      )}>
        <Alert className="mb-4">
          <AlertDescription>
            mTLS requires TLS to be configured on this host (certificate must be set).
            Select roles and/or individual certificates to allow.
          </AlertDescription>
        </Alert>

        <div className="space-y-4 mb-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Protected Paths (Optional)</label>
            <Textarea
              name="mtlsProtectedPaths"
              placeholder="/admin/*, /internal/*"
              defaultValue={value?.protected_paths?.join(", ") ?? ""}
              disabled={!enabled}
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to require mTLS for the entire domain. Comma-separated paths to require client certificates on specific routes only.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Excluded Paths (Optional)</label>
            <Textarea
              name="mtlsExcludedPaths"
              placeholder="/health, /public/*"
              defaultValue={value?.excluded_paths?.join(", ") ?? ""}
              disabled={!enabled}
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paths to exclude from mTLS. These paths bypass client certificate enforcement while all other paths remain protected. Ignored if Protected Paths is set.
            </p>
          </div>
        </div>

        {/* ── Trusted Roles ── */}
        {mtlsRoles.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                Trusted Roles
              </p>
              {selectedRoleIds.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-auto">{selectedRoleIds.length} selected</Badge>
              )}
            </div>
            <div className="rounded-md border bg-background mb-4">
              {mtlsRoles.map(role => (
                <div key={role.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 border-b last:border-b-0">
                  <Checkbox
                    checked={selectedRoleIds.includes(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <label className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleRole(role.id)}>
                    <span className="text-sm font-medium">{role.name}</span>
                    {role.description && <span className="text-xs text-muted-foreground ml-2">— {role.description}</span>}
                  </label>
                  <Badge variant="outline" className="text-xs shrink-0">{role.certificateCount} certs</Badge>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Trusted Certificates ── */}
        <div className="flex items-center gap-2 mb-2">
          <UserCheck className="h-4 w-4 text-amber-500" />
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
            Trusted Certificates
          </p>
          {selectedCertIds.length > 0 && (
            <Badge variant="secondary" className="text-xs ml-auto">{selectedCertIds.length} selected</Badge>
          )}
        </div>

        {activeCerts.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">No client certificates issued yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Issue certificates from a CA on the Certificates page.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from(certsByCA.entries()).map(([caId, certs]) => {
              const ca = caCertificates.find(c => c.id === caId);
              const caName = ca?.name ?? `CA #${caId}`;
              const allSelected = certs.every(c => selectedCertIds.includes(c.id));
              const someSelected = certs.some(c => selectedCertIds.includes(c.id));

              return (
                <div key={caId} className="rounded-md border bg-background">
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 rounded-t-md">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => toggleAllFromCA(caId)}
                      className={someSelected && !allSelected ? "opacity-60" : ""}
                    />
                    <label
                      className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer flex-1"
                      onClick={() => toggleAllFromCA(caId)}
                    >
                      {caName}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {certs.filter(c => selectedCertIds.includes(c.id)).length}/{certs.length}
                    </span>
                  </div>
                  <div className="border-t">
                    {certs.map(cert => (
                      <div key={cert.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/30">
                        <Checkbox
                          checked={selectedCertIds.includes(cert.id)}
                          onCheckedChange={() => toggleCert(cert.id)}
                          className="ml-4"
                        />
                        <label className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleCert(cert.id)}>
                          <span className="text-sm">{cert.commonName}</span>
                        </label>
                        <span className="text-xs text-muted-foreground shrink-0">
                          expires {new Date(cert.validTo).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!hasTrust && activeCerts.length > 0 && (
          <p className="text-xs text-destructive mt-2">No roles or certificates selected — mTLS will block all connections.</p>
        )}

        {/* ── RBAC rules ── */}
        {isEditMode && (
          <>
            <Separator className="my-4" />
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                  Path-Based Access Rules
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddRuleOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add Rule
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Restrict specific paths to certain roles or certificates. Paths without rules allow any trusted cert/role above.
            </p>

            {!rulesLoaded ? (
              <p className="text-xs text-muted-foreground text-center py-3">Loading...</p>
            ) : rules.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground">No access rules configured</p>
                <p className="text-xs text-muted-foreground mt-1">All trusted certificates/roles have equal access to every path.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {rules.map(rule => (
                  <div key={rule.id} className="group flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                    <code className="shrink-0 text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{rule.pathPattern}</code>
                    {rule.denyAll ? (
                      <Badge variant="destructive" className="text-xs gap-1"><Ban className="h-3 w-3" /> Deny</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                        {rule.allowedRoleIds.map(roleId => {
                          const role = mtlsRoles.find(r => r.id === roleId);
                          return <Badge key={`r-${roleId}`} variant="secondary" className="text-xs">{role?.name ?? `#${roleId}`}</Badge>;
                        })}
                        {rule.allowedCertIds.map(certId => {
                          const cert = issuedClientCerts.find(c => c.id === certId);
                          return <Badge key={`c-${certId}`} variant="outline" className="text-xs">{cert?.commonName ?? `#${certId}`}</Badge>;
                        })}
                        {rule.allowedRoleIds.length === 0 && rule.allowedCertIds.length === 0 && (
                          <span className="text-xs text-destructive italic">No roles/certs — effectively denied</span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditRule(rule)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => deleteRule(rule.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {addRuleOpen && (
              <RuleDialog onClose={() => setAddRuleOpen(false)} proxyHostId={proxyHostId!} roles={mtlsRoles} activeCerts={activeCerts} title="Add Access Rule" submitLabel="Add Rule" onSaved={loadRules} />
            )}
            {editRule && (
              <RuleDialog onClose={() => setEditRule(null)} proxyHostId={proxyHostId!} roles={mtlsRoles} activeCerts={activeCerts} title="Edit Access Rule" submitLabel="Save" existing={editRule} onSaved={loadRules} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RuleDialog({ onClose, proxyHostId, roles, activeCerts, title, submitLabel, existing, onSaved }: {
  onClose: () => void; proxyHostId: number; roles: MtlsRole[]; activeCerts: IssuedClientCertificate[];
  title: string; submitLabel: string; existing?: MtlsAccessRule; onSaved: () => void;
}) {
  const [pathPattern, setPathPattern] = useState(existing?.pathPattern ?? "*");
  const [priority, setPriority] = useState(String(existing?.priority ?? 0));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>(existing?.allowedRoleIds ?? []);
  const [selectedCertIds, setSelectedCertIds] = useState<number[]>(existing?.allowedCertIds ?? []);
  const [denyAll, setDenyAll] = useState(existing?.denyAll ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!pathPattern.trim()) { setError("Path pattern is required"); return; }
    setSubmitting(true); setError("");
    try {
      const url = existing
        ? `/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules/${existing.id}`
        : `/api/v1/proxy-hosts/${proxyHostId}/mtls-access-rules`;
      const res = await fetch(url, {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path_pattern: pathPattern.trim(), priority: Number(priority) || 0, description: description || null, allowed_role_ids: selectedRoleIds, allowed_cert_ids: selectedCertIds, deny_all: denyAll }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || `Failed (${res.status})`); setSubmitting(false); return; }
      onSaved(); onClose();
    } catch { setError("Network error"); setSubmitting(false); }
  }

  return (
    <AppDialog open onClose={onClose} title={title} submitLabel={submitLabel} onSubmit={handleSubmit} isSubmitting={submitting}>
      <div className="flex flex-col gap-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex gap-3">
          <div className="flex-1">
            <Label>Path Pattern</Label>
            <Input value={pathPattern} onChange={e => setPathPattern(e.target.value)} placeholder="*" />
            <p className="text-xs text-muted-foreground mt-1">Use * for all paths, /admin/* for prefix match</p>
          </div>
          <div className="w-20">
            <Label>Priority</Label>
            <Input type="number" value={priority} onChange={e => setPriority(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
          <Switch checked={denyAll} onCheckedChange={setDenyAll} />
          <Label className="text-sm cursor-pointer">Deny all access to this path</Label>
        </div>
        <div className={cn(denyAll && "opacity-30 pointer-events-none", "flex flex-col gap-4")}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Allowed Roles</p>
            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mTLS roles yet. Create roles on the Certificates page.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {roles.map(role => (
                  <div key={role.id} className="flex items-center gap-2 py-1 rounded hover:bg-muted/50 px-1">
                    <Checkbox checked={selectedRoleIds.includes(role.id)} onCheckedChange={() => setSelectedRoleIds(prev => prev.includes(role.id) ? prev.filter(i => i !== role.id) : [...prev, role.id])} />
                    <label className="text-sm cursor-pointer flex-1" onClick={() => setSelectedRoleIds(prev => prev.includes(role.id) ? prev.filter(i => i !== role.id) : [...prev, role.id])}>{role.name}</label>
                    {role.description && <span className="text-xs text-muted-foreground ml-1">— {role.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Allowed Specific Certificates</p>
            <p className="text-xs text-muted-foreground mb-1">These bypass role checks for this path</p>
            {activeCerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active client certificates.</p>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
                {activeCerts.map(cert => (
                  <div key={cert.id} className="flex items-center gap-2 py-1 rounded hover:bg-muted/50 px-1">
                    <Checkbox checked={selectedCertIds.includes(cert.id)} onCheckedChange={() => setSelectedCertIds(prev => prev.includes(cert.id) ? prev.filter(i => i !== cert.id) : [...prev, cert.id])} />
                    <label className="text-sm cursor-pointer flex-1" onClick={() => setSelectedCertIds(prev => prev.includes(cert.id) ? prev.filter(i => i !== cert.id) : [...prev, cert.id])}>{cert.commonName}</label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
