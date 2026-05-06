"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound, Plus, Search, ArrowUpDown, Users, Globe, Settings2,
  RefreshCw, Trash2, Sparkles,
  AlertTriangle, Clock, X,
} from "lucide-react";
import { toast } from "sonner";
import type { AccessList, AccessListUsage } from "@/lib/models/access-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  createAccessListAction,
  updateAccessListAction,
  deleteAccessListAction,
  addAccessEntryAction,
  deleteAccessEntryAction,
  bulkDeleteEntriesAction,
  regeneratePasswordAction,
} from "./actions";

type Props = {
  lists: AccessList[];
  usage: Record<number, AccessListUsage[]>;
};

// --- Helpers ---

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo ago`;
  return `${Math.floor(diff / 86400 / 365)}y ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function pwStrength(pw: string): { score: number; label: string; variant: "muted" | "destructive" | "warning" | "info" | "success" } {
  if (!pw) return { score: 0, label: "Empty", variant: "muted" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map: { label: string; variant: "muted" | "destructive" | "warning" | "info" | "success" }[] = [
    { label: "Empty", variant: "muted" },
    { label: "Weak", variant: "destructive" },
    { label: "Fair", variant: "warning" },
    { label: "Good", variant: "info" },
    { label: "Strong", variant: "success" },
    { label: "Excellent", variant: "success" },
  ];
  return { score: s, ...map[s] };
}

function genPassword(len = 18): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%&*";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => chars[v % chars.length]).join("");
}

type SortKey = "recent" | "name" | "members" | "usage";

// --- Password Cell ---

function PasswordCell({ onRegenerate }: { onRegenerate: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-xs tracking-tight text-muted-foreground">
        ••••••••••••
      </span>
      <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-primary" onClick={onRegenerate} title="Regenerate password (copies new password to clipboard)">
        <RefreshCw className="h-3 w-3" />
      </Button>
    </div>
  );
}

// --- Members Tab ---

function MembersTab({
  list,
  onListUpdated,
}: {
  list: AccessList;
  onListUpdated: (list: AccessList) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ username: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const toggleAll = () => {
    if (selected.size === list.entries.length) setSelected(new Set());
    else setSelected(new Set(list.entries.map((e) => e.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const removeSelected = async () => {
    const ids = Array.from(selected);
    const updated = await bulkDeleteEntriesAction(list.id, ids);
    if (updated) onListUpdated(updated);
    toast.success(`Removed ${ids.length} ${ids.length === 1 ? "member" : "members"}`);
    setSelected(new Set());
  };

  const removeOne = async (id: number) => {
    const entry = list.entries.find((e) => e.id === id);
    const updated = await deleteAccessEntryAction(list.id, id);
    if (updated) onListUpdated(updated);
    toast.success(`Removed ${entry?.username ?? "member"}`);
  };

  const regen = async (id: number) => {
    const pw = genPassword();
    const updated = await regeneratePasswordAction(list.id, id, pw);
    if (updated) onListUpdated(updated);
    try {
      await navigator.clipboard.writeText(pw);
      toast.success("New password generated and copied");
    } catch {
      toast.success("New password generated");
    }
  };

  const submitNew = async () => {
    if (!draft.username.trim() || !draft.password) return;
    if (list.entries.some((e) => e.username === draft.username.trim())) {
      toast.error("Username already exists");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await addAccessEntryAction(list.id, {
        username: draft.username.trim(),
        password: draft.password,
      });
      onListUpdated(updated);
      setDraft({ username: "", password: "" });
      setAdding(false);
      toast.success(`Added ${draft.username.trim()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = pwStrength(draft.password);

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between py-3 gap-3">
        <div className="flex items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span className="text-sm font-medium">{selected.size} selected</span>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={removeSelected}>
                <Trash2 className="h-3 w-3 mr-1" /> Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Cancel</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {list.entries.length} {list.entries.length === 1 ? "member" : "members"}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3 mr-1" /> Add member
        </Button>
      </div>

      {/* Add member row */}
      {adding && (
        <div className="rounded-lg border bg-muted/40 p-3 mb-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_auto] gap-3 items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user" className="text-xs">
                Username <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-user"
                autoFocus
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                placeholder="alice.chen"
                className="font-mono h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="new-pw" className="text-xs">
                  Password <span className="text-destructive">*</span>
                </Label>
                {draft.password && (
                  <Badge variant={strength.variant} className="text-[10px] h-4 px-1.5">
                    {strength.label}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    id="new-pw"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    placeholder="auto-generate or paste"
                    className="font-mono h-8 text-sm pr-2"
                  />
                  {draft.password && (
                    <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full overflow-hidden bg-border">
                      <span
                        style={{ width: `${(strength.score / 5) * 100}%` }}
                        className={cn(
                          "block h-full transition-all",
                          strength.variant === "destructive" && "bg-destructive",
                          strength.variant === "warning" && "bg-amber-500",
                          strength.variant === "info" && "bg-primary",
                          strength.variant === "success" && "bg-emerald-500",
                        )}
                      />
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setDraft((d) => ({ ...d, password: genPassword() }))}
                  title="Generate strong password"
                >
                  <Sparkles className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8" onClick={() => { setAdding(false); setDraft({ username: "", password: "" }); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={submitNew}
                disabled={!draft.username.trim() || !draft.password || submitting}
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Members table */}
      {list.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center text-center px-6 py-14 gap-3">
          <div className="h-12 w-12 rounded-full grid place-items-center bg-muted text-muted-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">No members yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Add the first credentials. Anyone using this list to reach a proxy host will be denied until at least one account exists.
            </p>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add the first member
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-muted/50 border-b">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-9 pl-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === list.entries.length && list.entries.length > 0}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                </th>
                <th className="py-2 pr-2 font-semibold">Username</th>
                <th className="py-2 px-2 font-semibold">Password</th>
                <th className="py-2 px-2 font-semibold hidden lg:table-cell">Added</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.entries.map((e) => {
                const checked = selected.has(e.id);
                return (
                  <tr
                    key={e.id}
                    className={cn(
                      "h-11 transition-colors",
                      checked ? "bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <td className="pl-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(e.id)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </td>
                    <td className="pr-2">
                      <span className="font-mono text-sm font-medium">{e.username}</span>
                    </td>
                    <td className="px-2">
                      <PasswordCell onRegenerate={() => regen(e.id)} />
                    </td>
                    <td className="px-2 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</span>
                    </td>
                    <td className="pr-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        title="Remove"
                        onClick={() => removeOne(e.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Settings Tab ---

function SettingsTab({
  list,
  usageCount,
  onListUpdated,
  onDeleted,
}: {
  list: AccessList;
  usageCount: number;
  onListUpdated: (list: AccessList) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [desc, setDesc] = useState(list.description || "");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(list.name);
    setDesc(list.description || "");
    setConfirm("");
  }, [list.id, list.name, list.description]);

  const dirty = name !== list.name || (desc || "") !== (list.description || "");

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateAccessListAction(list.id, {
        name: name.trim() || list.name,
        description: desc.trim() || null,
      });
      onListUpdated(updated);
      toast.success("Saved");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccessListAction(list.id);
      toast.success(`Deleted "${list.name}"`);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl pt-4">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-name" className="text-xs">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-desc" className="text-xs">Description</Label>
          <textarea
            id="s-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What is this list for? Who manages it?"
            className="flex min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={save} disabled={!dirty || !name.trim() || saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => { setName(list.name); setDesc(list.description || ""); }}>
              Discard
            </Button>
          )}
        </div>
      </section>

      {/* Metadata */}
      <section className="rounded-lg border divide-y">
        {([
          ["Created", fmtDate(list.createdAt)],
          ["Last updated", fmtRelative(list.updatedAt)],
          ["List ID", <span key="id" className="font-mono">{list.id}</span>],
        ] as [string, React.ReactNode][]).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/30 overflow-hidden">
        <div className="px-4 py-3 bg-destructive/5 border-b border-destructive/20">
          <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
          </p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">Delete this access list</p>
            <p className="text-xs text-muted-foreground">
              {usageCount > 0
                ? <>This list is currently <strong>used by {usageCount} proxy {usageCount === 1 ? "host" : "hosts"}</strong>. Those hosts will be left without authentication.</>
                : "Once deleted, the credentials cannot be recovered."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              Type <span className="font-mono">{list.name}</span> to confirm
            </Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={list.name}
              className={cn("max-w-md h-8 text-sm", confirm.length > 0 && confirm !== list.name && "border-destructive")}
            />
          </div>
          <div>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirm !== list.name || deleting}
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {deleting ? "Deleting..." : "Delete list permanently"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Usage Tab ---

function UsageTab({ hosts }: { hosts: AccessListUsage[] }) {
  if (hosts.length === 0) {
    return (
      <div className="pt-2">
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center text-center px-6 py-14 gap-3">
          <div className="h-12 w-12 rounded-full grid place-items-center bg-muted text-muted-foreground">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Not used by any proxy host</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              This list is currently dormant. You can keep it for later, or delete it from Settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      <p className="text-sm text-muted-foreground">
        This access list guards <strong className="text-foreground">{hosts.length}</strong> proxy {hosts.length === 1 ? "host" : "hosts"}.
        Removing the list, or any of its members, will affect access to these hosts.
      </p>
      <div className="rounded-lg border divide-y overflow-hidden">
        {hosts.map((h) => (
          <div key={h.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                <Globe className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-sm truncate">{h.domains[0] ?? h.name}</p>
                {h.domains.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">+{h.domains.length - 1} more domain{h.domains.length - 1 > 1 ? "s" : ""}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={h.enabled ? "success" : "muted"}>
                {h.enabled ? "active" : "disabled"}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Detail Pane ---

function DetailPane({
  list,
  usage,
  onListUpdated,
  onDeleted,
}: {
  list: AccessList | null;
  usage: AccessListUsage[];
  onListUpdated: (list: AccessList) => void;
  onDeleted: () => void;
}) {
  if (!list) {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center justify-center text-center px-6 py-14 gap-3">
          <div className="h-12 w-12 rounded-full grid place-items-center bg-muted text-muted-foreground">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Select an access list</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Pick one from the list on the left, or create a new one.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 animate-in fade-in duration-150">
      {/* Header */}
      <header className="px-6 pt-6 pb-3 flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold tracking-tight truncate">{list.name}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {list.description || <span className="italic opacity-70">No description</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            <Badge variant="default" className="gap-1">
              <Users className="h-2.5 w-2.5" />
              {list.entries.length} {list.entries.length === 1 ? "member" : "members"}
            </Badge>
            <Badge variant="muted" className="gap-1">
              <Globe className="h-2.5 w-2.5" />
              {usage.length} {usage.length === 1 ? "host" : "hosts"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Clock className="h-2.5 w-2.5" />
              updated {fmtRelative(list.updatedAt)}
            </Badge>
            {usage.length === 0 && <Badge variant="warning">unused</Badge>}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs defaultValue="members" className="flex-1 flex flex-col min-h-0">
        <div className="px-6">
          <TabsList className="h-9">
            <TabsTrigger value="members" className="text-xs gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Members
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {list.entries.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="usage" className="text-xs gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Used by
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {usage.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="px-6 pb-10 flex-1 overflow-y-auto">
          <TabsContent value="members">
            <MembersTab list={list} onListUpdated={onListUpdated} />
          </TabsContent>
          <TabsContent value="usage">
            <UsageTab hosts={usage} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab
              list={list}
              usageCount={usage.length}
              onListUpdated={onListUpdated}
              onDeleted={onDeleted}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// --- New List Dialog ---

function NewListDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (list: AccessList) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [seed, setSeed] = useState([{ username: "", password: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDesc("");
      setSeed([{ username: "", password: "" }]);
    }
  }, [open]);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const list = await createAccessListAction({
        name: name.trim(),
        description: desc.trim() || null,
        users: seed.filter((s) => s.username.trim() && s.password),
      });
      onCreate(list);
      onClose();
      toast.success(`Created "${list.name}"`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New access list</DialogTitle>
          <DialogDescription>
            Define a set of credentials you can attach to one or more proxy hosts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internal — Engineering" className="h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Description <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this list for?" className="h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Seed members <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
            <div className="flex flex-col gap-1.5">
              {seed.map((s, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <Input
                    value={s.username}
                    onChange={(e) => setSeed(seed.map((x, j) => j === i ? { ...x, username: e.target.value } : x))}
                    placeholder="username"
                    className="font-mono flex-1 h-8 text-sm"
                  />
                  <Input
                    value={s.password}
                    onChange={(e) => setSeed(seed.map((x, j) => j === i ? { ...x, password: e.target.value } : x))}
                    placeholder="password"
                    className="font-mono flex-1 h-8 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Generate password"
                    onClick={() => setSeed(seed.map((x, j) => j === i ? { ...x, password: genPassword() } : x))}
                  >
                    <Sparkles className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setSeed(seed.length === 1 ? [{ username: "", password: "" }] : seed.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <button
                onClick={() => setSeed([...seed, { username: "", password: "" }])}
                className="self-start text-xs text-primary hover:underline mt-0.5"
              >
                + Add another member
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? "Creating..." : "Create list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Lists Rail (left sidebar) ---

function ListsRail({
  lists,
  selectedId,
  onSelect,
  onNew,
  query,
  setQuery,
  sort,
  setSort,
  usage,
}: {
  lists: AccessList[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  usage: Record<number, AccessListUsage[]>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    let arr = lists.slice();
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.description || "").toLowerCase().includes(q) ||
          l.entries.some((e) => e.username.toLowerCase().includes(q))
      );
    }
    arr.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "members") return b.entries.length - a.entries.length;
      if (sort === "recent") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sort === "usage") return (usage[b.id]?.length ?? 0) - (usage[a.id]?.length ?? 0);
      return 0;
    });
    return arr;
  }, [lists, query, sort, usage]);

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "name", label: "Name" },
    { value: "members", label: "Members" },
    { value: "usage", label: "Usage" },
  ];

  return (
    <div className="flex flex-col w-[320px] shrink-0 border-r">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Access Lists</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {lists.length} {lists.length === 1 ? "list" : "lists"} · HTTP basic auth
          </p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="h-3 w-3 mr-1" /> New
        </Button>
      </div>

      {/* Search + sort */}
      <div className="px-3 pb-2 flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists or members..."
            className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-14 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
              {"\u2318"}K
            </kbd>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-3 w-3 text-muted-foreground ml-1" />
          {sortOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => setSort(o.value)}
              className={cn(
                "h-6 px-2 rounded text-[11px] transition-colors",
                sort === o.value
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No lists match &ldquo;{query}&rdquo;.</p>
            <button onClick={() => setQuery("")} className="text-xs text-primary mt-1 hover:underline">
              Clear search
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((list) => {
              const active = list.id === selectedId;
              const orphaned = (usage[list.id]?.length ?? 0) === 0;
              return (
                <li key={list.id}>
                  <button
                    onClick={() => onSelect(list.id)}
                    className={cn(
                      "w-full text-left rounded-md px-2.5 py-2 transition-colors group",
                      active ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={cn(
                          "mt-0.5 h-7 w-7 rounded-md grid place-items-center shrink-0 transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground group-hover:text-foreground"
                        )}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm truncate", active ? "font-semibold" : "font-medium")}>
                          {list.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {list.entries.length} {list.entries.length === 1 ? "member" : "members"} · {usage[list.id]?.length ?? 0} {(usage[list.id]?.length ?? 0) === 1 ? "host" : "hosts"}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {orphaned && <Badge variant="warning" className="text-[10px] h-4 px-1.5">unused</Badge>}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Main Client Component ---

export default function AccessListsClient({ lists: initialLists, usage: initialUsage }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState(initialLists);
  const [usage, setUsage] = useState(initialUsage);
  const [selectedId, setSelectedId] = useState<number | null>(initialLists[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [newOpen, setNewOpen] = useState(false);

  // Sync from server props when they change (e.g. after revalidation)
  useEffect(() => {
    setLists(initialLists);
    setUsage(initialUsage);
  }, [initialLists, initialUsage]);

  const selected = lists.find((l) => l.id === selectedId) ?? null;

  const handleListUpdated = useCallback((updated: AccessList) => {
    setLists((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
    router.refresh();
  }, [router]);

  const handleDeleted = useCallback(() => {
    setLists((ls) => ls.filter((l) => l.id !== selectedId));
    setSelectedId(lists.find((l) => l.id !== selectedId)?.id ?? null);
    router.refresh();
  }, [selectedId, lists, router]);

  const handleCreated = useCallback((list: AccessList) => {
    setLists((ls) => [list, ...ls]);
    setSelectedId(list.id);
    router.refresh();
  }, [router]);

  // Keyboard shortcut: N to create
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* Split layout: rail + detail — break out of parent padding to fill width */}
      <div className="flex h-[calc(100vh-48px)] md:h-screen border-t md:border-t-0">
        <ListsRail
          lists={lists}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={() => setNewOpen(true)}
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          usage={usage}
        />
        <DetailPane
          list={selected}
          usage={usage[selectedId ?? -1] ?? []}
          onListUpdated={handleListUpdated}
          onDeleted={handleDeleted}
        />
      </div>

      <NewListDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={handleCreated}
      />
    </>
  );
}
