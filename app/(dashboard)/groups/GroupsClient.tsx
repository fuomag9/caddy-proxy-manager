"use client";

import { useState } from "react";
import { Users, Plus, Trash2, UserPlus, UserMinus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "next/navigation";
import {
  createGroupAction,
  deleteGroupAction,
  addGroupMemberAction,
  removeGroupMemberAction
} from "./actions";

type GroupMember = {
  user_id: number;
  email: string;
  name: string | null;
  created_at: string;
};

type Group = {
  id: number;
  name: string;
  description: string | null;
  members: GroupMember[];
  created_at: string;
  updated_at: string;
};

type UserEntry = {
  id: number;
  email: string;
  name: string | null;
  role: string;
};

type Props = {
  groups: Group[];
  users: UserEntry[];
};

export default function GroupsClient({ groups, users }: Props) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [addMemberGroupId, setAddMemberGroupId] = useState<number | null>(null);

  function getAvailableUsers(group: Group): UserEntry[] {
    const memberIds = new Set(group.members.map((m) => m.user_id));
    return users.filter((u) => !memberIds.has(u.id));
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Groups"
        description="Organize users into groups for forward auth access control."
      />

      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(!showCreate)} variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Group
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-4">
            <form
              action={async (formData) => {
                await createGroupAction(formData);
                setShowCreate(false);
                router.refresh();
              }}
              className="flex flex-col gap-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" placeholder="e.g. Developers" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" placeholder="Optional description" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Create</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {groups.length === 0 && !showCreate && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No groups yet. Create one to organize user access.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {groups.map((group) => {
          const available = getAvailableUsers(group);
          return (
            <Card key={group.id} className="border-l-4 border-l-blue-500">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-base">{group.name}</h3>
                    {group.description && (
                      <p className="text-sm text-muted-foreground">{group.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5">
                      {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        setAddMemberGroupId(addMemberGroupId === group.id ? null : group.id)
                      }
                      title="Add member"
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={async () => {
                        if (confirm(`Delete group "${group.name}"?`)) {
                          await deleteGroupAction(group.id);
                          router.refresh();
                        }
                      }}
                      title="Delete group"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {addMemberGroupId === group.id && (
                  <div className="mb-3">
                    <p className="text-sm font-medium mb-2">Add a user to this group</p>
                    {available.length === 0 ? (
                      <p className="text-sm text-muted-foreground">All users are already in this group.</p>
                    ) : (
                      <div className="border rounded-md max-h-48 overflow-y-auto">
                        {available.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                            onClick={async () => {
                              await addGroupMemberAction(group.id, user.id);
                              setAddMemberGroupId(null);
                              router.refresh();
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                                {(user.name ?? user.email)[0]?.toUpperCase()}
                              </div>
                              <div>
                                <span className="text-sm">{user.name ?? user.email.split("@")[0]}</span>
                                <span className="text-xs text-muted-foreground ml-2">{user.email}</span>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground capitalize">{user.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => setAddMemberGroupId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {group.members.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <div className="space-y-1">
                      {group.members.map((member) => (
                        <div
                          key={member.user_id}
                          className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50"
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                              {(member.name ?? member.email)[0]?.toUpperCase()}
                            </div>
                            <span className="text-sm">
                              {member.name ?? member.email.split("@")[0]}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={async () => {
                              await removeGroupMemberAction(group.id, member.user_id);
                              router.refresh();
                            }}
                            title="Remove member"
                          >
                            <UserMinus className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
