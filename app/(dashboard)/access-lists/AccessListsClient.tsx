"use client";

import { Trash2 } from "lucide-react";
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
        {lists.map((list) => (
          <Card key={list.id}>
            <CardContent className="flex flex-col gap-4 pt-6">
              <form action={(formData) => updateAccessListAction(list.id, formData)} className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Access List</h2>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`name-${list.id}`}>Name</Label>
                  <Input id={`name-${list.id}`} name="name" defaultValue={list.name} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`desc-${list.id}`}>Description</Label>
                  <textarea
                    id={`desc-${list.id}`}
                    name="description"
                    defaultValue={list.description ?? ""}
                    rows={2}
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="submit" variant="default">
                    Save
                  </Button>
                  <Button
                    type="submit"
                    formAction={deleteAccessListAction.bind(null, list.id)}
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                  >
                    Delete list
                  </Button>
                </div>
              </form>

              <Separator />

              <div className="flex flex-col gap-2">
                <p className="font-semibold">Accounts</p>
                {list.entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No credentials configured.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {list.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{entry.username}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(entry.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <form action={deleteAccessEntryAction.bind(null, list.id, entry.id)}>
                          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <form
                action={(formData) => addAccessEntryAction(list.id, formData)}
                className="flex flex-col sm:flex-row gap-2 items-end"
              >
                <div className="flex flex-col gap-1.5 w-full">
                  <Label htmlFor={`username-${list.id}`}>Username</Label>
                  <Input id={`username-${list.id}`} name="username" required />
                </div>
                <div className="flex flex-col gap-1.5 w-full">
                  <Label htmlFor={`password-${list.id}`}>Password</Label>
                  <Input id={`password-${list.id}`} name="password" type="password" required />
                </div>
                <Button type="submit" className="shrink-0">Add</Button>
              </form>
            </CardContent>
          </Card>
        ))}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Create access list</h2>
        <Card>
          <CardContent className="pt-6">
            <form action={createAccessListAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-name">Name</Label>
                <Input id="create-name" name="name" placeholder="Internal users" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-description">Description</Label>
                <textarea
                  id="create-description"
                  name="description"
                  placeholder="Optional description"
                  rows={2}
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-users">Seed members</Label>
                <textarea
                  id="create-users"
                  name="users"
                  rows={3}
                  placeholder="One per line, username:password"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
                <p className="text-xs text-muted-foreground">One per line, username:password</p>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Create Access List</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
