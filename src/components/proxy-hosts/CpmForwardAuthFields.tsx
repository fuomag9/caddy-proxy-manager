import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Users, UserCheck } from "lucide-react";
import { ProxyHost } from "@/lib/models/proxy-hosts";

type UserEntry = {
    id: number;
    email: string;
    name: string | null;
    role: string;
};

type GroupEntry = {
    id: number;
    name: string;
    description: string | null;
    member_count: number;
};

type ForwardAuthAccessData = {
    userIds: number[];
    groupIds: number[];
};

export function CpmForwardAuthFields({
    cpmForwardAuth,
    users = [],
    groups = [],
    currentAccess,
}: {
    cpmForwardAuth?: ProxyHost["cpm_forward_auth"] | null;
    users?: UserEntry[];
    groups?: GroupEntry[];
    currentAccess?: ForwardAuthAccessData | null;
}) {
    const initial = cpmForwardAuth ?? null;
    const [enabled, setEnabled] = useState(initial?.enabled ?? false);
    const [selectedUserIds, setSelectedUserIds] = useState<number[]>(currentAccess?.userIds ?? []);
    const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(currentAccess?.groupIds ?? []);

    function toggleUser(id: number) {
        setSelectedUserIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }

    function toggleGroup(id: number) {
        setSelectedGroupIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }

    const allUsers = users;

    return (
        <div className="rounded-lg border border-primary bg-primary/5 p-5">
            <input type="hidden" name="cpm_forward_auth_present" value="1" />
            <input type="hidden" name="cpm_forward_auth_enabled_present" value="1" />
            {enabled && selectedUserIds.map((id) => (
                <input key={`faa-u-${id}`} type="hidden" name="cpm_fa_user_id" value={String(id)} />
            ))}
            {enabled && selectedGroupIds.map((id) => (
                <input key={`faa-g-${id}`} type="hidden" name="cpm_fa_group_id" value={String(id)} />
            ))}
            <div className="flex flex-col gap-4">
                <div className="flex flex-row items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold">CPM Forward Auth</p>
                        <p className="text-sm text-muted-foreground">
                            Require users to authenticate via Caddy Proxy Manager before accessing this host
                        </p>
                    </div>
                    <Switch
                        name="cpm_forward_auth_enabled"
                        checked={enabled}
                        onCheckedChange={setEnabled}
                    />
                </div>

                <div className={cn(
                    "overflow-hidden transition-all duration-200",
                    enabled ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                )}>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">Protected Paths (Optional)</label>
                            <Textarea
                                name="cpm_forward_auth_protected_paths"
                                placeholder="/secret/*, /admin/*"
                                defaultValue={initial?.protected_paths?.join(", ") ?? ""}
                                disabled={!enabled}
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Leave empty to protect entire domain. Comma-separated paths to protect specific routes only.
                            </p>
                        </div>

                        {/* Allowed Groups */}
                        {groups.length > 0 && (
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <Users className="h-4 w-4 text-primary" />
                                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                                        Allowed Groups
                                    </p>
                                    {selectedGroupIds.length > 0 && (
                                        <Badge variant="secondary" className="text-xs ml-auto">
                                            {selectedGroupIds.length} selected
                                        </Badge>
                                    )}
                                </div>
                                <div className="rounded-md border bg-background">
                                    {groups.map((group) => (
                                        <div
                                            key={group.id}
                                            className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 border-b last:border-b-0"
                                        >
                                            <Checkbox
                                                checked={selectedGroupIds.includes(group.id)}
                                                onCheckedChange={() => toggleGroup(group.id)}
                                            />
                                            <label
                                                className="flex-1 min-w-0 cursor-pointer"
                                                onClick={() => toggleGroup(group.id)}
                                            >
                                                <span className="text-sm font-medium">{group.name}</span>
                                                {group.description && (
                                                    <span className="text-xs text-muted-foreground ml-2">
                                                        — {group.description}
                                                    </span>
                                                )}
                                            </label>
                                            <Badge variant="outline" className="text-xs shrink-0">
                                                {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Allowed Users */}
                        {allUsers.length > 0 && (
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <UserCheck className="h-4 w-4 text-primary" />
                                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                                        Allowed Users
                                    </p>
                                    {selectedUserIds.length > 0 && (
                                        <Badge variant="secondary" className="text-xs ml-auto">
                                            {selectedUserIds.length} selected
                                        </Badge>
                                    )}
                                </div>
                                <div className="rounded-md border bg-background max-h-52 overflow-y-auto">
                                    {allUsers.map((user) => (
                                        <div
                                            key={user.id}
                                            className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 border-b last:border-b-0"
                                        >
                                            <Checkbox
                                                checked={selectedUserIds.includes(user.id)}
                                                onCheckedChange={() => toggleUser(user.id)}
                                            />
                                            <label
                                                className="flex-1 min-w-0 cursor-pointer"
                                                onClick={() => toggleUser(user.id)}
                                            >
                                                <span className="text-sm">
                                                    {user.name ?? user.email.split("@")[0]}
                                                </span>
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    {user.email}
                                                </span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {groups.length === 0 && allUsers.length === 0 && (
                            <div className="rounded border border-dashed p-4 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No groups or users yet. Create groups on the Groups page.
                                </p>
                            </div>
                        )}

                        {selectedGroupIds.length === 0 && selectedUserIds.length === 0 && (groups.length > 0 || allUsers.length > 0) && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                No users or groups selected — nobody will be able to access this host.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
