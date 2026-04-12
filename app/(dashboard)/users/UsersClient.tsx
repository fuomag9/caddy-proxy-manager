"use client";

import { useState } from "react";
import { UserCog, Trash2, Pencil, Ban, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import {
  updateUserRoleAction,
  updateUserStatusAction,
  updateUserInfoAction,
  deleteUserAction,
} from "./actions";

type UserEntry = {
  id: number;
  email: string;
  name: string | null;
  role: "admin" | "user" | "viewer";
  provider: string | null;
  subject: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  users: UserEntry[];
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  user: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  viewer: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  disabled: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
};

export default function UsersClient({ users }: Props) {
  const router = useRouter();
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = search
    ? users.filter(
        (u) =>
          u.name?.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          u.role.includes(search.toLowerCase())
      )
    : users;

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Users"
        description="Manage user accounts, roles, and access."
      />

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} user{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <UserCog className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No users found.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {filtered.map((user) => (
          <Card key={user.id}>
            <CardContent className="py-3 px-4">
              {editUserId === user.id ? (
                <EditUserRow
                  user={user}
                  onClose={() => setEditUserId(null)}
                  onSave={() => {
                    setEditUserId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <UserRow
                  user={user}
                  onEdit={() => setEditUserId(user.id)}
                  onRefresh={() => router.refresh()}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UserRow({
  user,
  onEdit,
  onRefresh,
}: {
  user: UserEntry;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const isDisabled = user.status !== "active";

  return (
    <div className="flex items-center gap-3">
      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0">
        {(user.name ?? user.email)[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {user.name ?? user.email.split("@")[0]}
          </span>
          {isDisabled && (
            <Badge variant="outline" className={STATUS_COLORS.disabled}>
              disabled
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{user.email}</span>
          <span>·</span>
          <span>{user.provider}</span>
        </div>
      </div>
      <Badge variant="outline" className={ROLE_COLORS[user.role] ?? ""}>
        {user.role}
      </Badge>
      <div className="flex items-center gap-1 shrink-0">
        {user.status === "active" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-amber-500"
            title="Disable user"
            onClick={async () => {
              if (confirm(`Disable user "${user.name ?? user.email}"?`)) {
                await updateUserStatusAction(user.id, "disabled");
                onRefresh();
              }
            }}
          >
            <Ban className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-emerald-500"
            title="Enable user"
            onClick={async () => {
              await updateUserStatusAction(user.id, "active");
              onRefresh();
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Edit user"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          title="Delete user"
          onClick={async () => {
            if (confirm(`Permanently delete user "${user.name ?? user.email}"? This cannot be undone.`)) {
              await deleteUserAction(user.id);
              onRefresh();
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EditUserRow({
  user,
  onClose,
  onSave,
}: {
  user: UserEntry;
  onClose: () => void;
  onSave: () => void;
}) {
  const [role, setRole] = useState(user.role);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Pencil className="h-4 w-4" />
        Editing {user.name ?? user.email}
      </div>
      <form
        action={async (formData) => {
          await updateUserInfoAction(user.id, formData);
          if (role !== user.role) {
            await updateUserRoleAction(user.id, role);
          }
          onSave();
        }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <div className="space-y-1">
          <Label htmlFor={`name-${user.id}`}>Name</Label>
          <Input
            id={`name-${user.id}`}
            name="name"
            defaultValue={user.name ?? ""}
            placeholder="Display name"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`email-${user.id}`}>Email</Label>
          <Input
            id={`email-${user.id}`}
            name="email"
            defaultValue={user.email}
            placeholder="Email address"
          />
        </div>
        <div className="space-y-1">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as UserEntry["role"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-3 flex gap-2">
          <Button type="submit" size="sm">Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
