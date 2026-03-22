"use client";

import { Shield, Trash2, UserPlus, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { AccessList } from "@/lib/models/access-lists";
import {
  addAccessEntryAction,
  createAccessListAction,
  deleteAccessEntryAction,
  deleteAccessListAction,
  updateAccessListAction
} from "./actions";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Props = {
  lists: AccessList[];
  pagination: { total: number; page: number; perPage: number };
};

// Cycling accent colors per card
const ACCENT_COLORS = [
  {
    border: "border-l-violet-500",
    icon: "border-violet-500/30 bg-violet-500/10 text-violet-500",
    countBadge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    avatar: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  {
    border: "border-l-cyan-500",
    icon: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500",
    countBadge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    avatar: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  },
  {
    border: "border-l-emerald-500",
    icon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    countBadge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    avatar: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  {
    border: "border-l-amber-500",
    icon: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    countBadge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    avatar: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  {
    border: "border-l-rose-500",
    icon: "border-rose-500/30 bg-rose-500/10 text-rose-500",
    countBadge: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    avatar: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
];

function getInitials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

export default function AccessListsClient({ lists, pagination }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.ceil(pagination.total / pagination.perPage);

  function handlePageChange(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Access Lists"
        description="Protect proxy hosts with HTTP basic authentication credentials."
      />

      <div className="flex flex-col gap-4">
        {lists.map((list, idx) => {
          const accent = ACCENT_COLORS[idx % ACCENT_COLORS.length];
          return (
            <Card key={list.id} className={`border-l-2 ${accent.border}`}>
              <CardContent className="flex flex-col gap-5 pt-5 pb-5 px-5">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.icon}`}>
                    <Shield className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{list.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {list.entries.length} {list.entries.length === 1 ? "account" : "accounts"}
                      {list.description && ` · ${list.description}`}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${accent.countBadge}`}>
                    {list.entries.length}
                  </span>
                </div>

                {/* Edit form */}
                <form action={(formData) => updateAccessListAction(list.id, formData)} className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`name-${list.id}`} className="text-xs">Name</Label>
                      <Input id={`name-${list.id}`} name="name" defaultValue={list.name} className="h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`desc-${list.id}`} className="text-xs">Description</Label>
                      <Input
                        id={`desc-${list.id}`}
                        name="description"
                        defaultValue={list.description ?? ""}
                        placeholder="Optional"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
                      Save
                    </Button>
                    <Button
                      type="submit"
                      formAction={deleteAccessListAction.bind(null, list.id)}
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    >
                      Delete list
                    </Button>
                  </div>
                </form>

                <Separator />

                {/* Accounts list */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accounts</p>

                  {list.entries.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                      <UserPlus className="h-4 w-4 shrink-0" />
                      No accounts yet — add one below.
                    </div>
                  ) : (
                    <div className="flex flex-col divide-y divide-border rounded-md border overflow-hidden">
                      {list.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${accent.avatar}`}>
                              {getInitials(entry.username)}
                            </span>
                            <div>
                              <p className="text-sm font-medium font-mono leading-tight">{entry.username}</p>
                              <p className="text-xs text-muted-foreground">
                                Added {new Date(entry.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <form action={deleteAccessEntryAction.bind(null, list.id, entry.id)}>
                            <Button type="submit" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add account */}
                <form
                  action={(formData) => addAccessEntryAction(list.id, formData)}
                  className="flex flex-col sm:flex-row gap-2 items-end"
                >
                  <div className="flex flex-col gap-1.5 w-full">
                    <Label htmlFor={`username-${list.id}`} className="text-xs">Username</Label>
                    <Input id={`username-${list.id}`} name="username" required placeholder="username" className="h-8 text-sm font-mono" />
                  </div>
                  <div className="flex flex-col gap-1.5 w-full">
                    <Label htmlFor={`password-${list.id}`} className="text-xs">Password</Label>
                    <Input id={`password-${list.id}`} name="password" type="password" required placeholder="••••••••" className="h-8 text-sm" />
                  </div>
                  <Button type="submit" size="sm" className="shrink-0 h-8 gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex justify-center gap-2 mt-2">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <Button
              key={page}
              variant={page === pagination.page ? "default" : "outline"}
              size="sm"
              onClick={() => handlePageChange(page)}
            >
              {page}
            </Button>
          ))}
        </div>
      )}

      {/* Create new */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-muted-foreground/50 text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">New access list</h2>
        </div>
        <Card className="border-dashed">
          <CardContent className="pt-5 pb-5">
            <form action={createAccessListAction} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-name" className="text-xs">Name <span className="text-destructive">*</span></Label>
                  <Input id="create-name" name="name" placeholder="Internal users" required className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-description" className="text-xs">Description</Label>
                  <Input id="create-description" name="description" placeholder="Optional description" className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-users" className="text-xs">Seed members</Label>
                <textarea
                  id="create-users"
                  name="users"
                  rows={3}
                  placeholder="One per line: username:password"
                  className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  <Shield className="h-3.5 w-3.5 mr-1.5" />
                  Create Access List
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
