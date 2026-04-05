import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { groups, groupMembers, users } from "../db/schema";
import { asc, eq, inArray, count } from "drizzle-orm";

export type Group = {
  id: number;
  name: string;
  description: string | null;
  members: GroupMember[];
  created_at: string;
  updated_at: string;
};

export type GroupMember = {
  user_id: number;
  email: string;
  name: string | null;
  created_at: string;
};

export type GroupInput = {
  name: string;
  description?: string | null;
};

type GroupRow = typeof groups.$inferSelect;

function toGroup(row: GroupRow, members: GroupMember[]): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    members,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!
  };
}

export async function listGroups(): Promise<Group[]> {
  const allGroups = await db.query.groups.findMany({
    orderBy: (table) => asc(table.name)
  });

  if (allGroups.length === 0) return [];

  const groupIds = allGroups.map((g) => g.id);
  const allMembers = await db
    .select({
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      email: users.email,
      name: users.name,
      createdAt: groupMembers.createdAt
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(inArray(groupMembers.groupId, groupIds));

  const membersByGroup = new Map<number, GroupMember[]>();
  for (const m of allMembers) {
    const bucket = membersByGroup.get(m.groupId) ?? [];
    bucket.push({
      user_id: m.userId,
      email: m.email,
      name: m.name,
      created_at: toIso(m.createdAt)!
    });
    membersByGroup.set(m.groupId, bucket);
  }

  return allGroups.map((g) => toGroup(g, membersByGroup.get(g.id) ?? []));
}

export async function countGroups(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(groups);
  return row?.value ?? 0;
}

export async function getGroup(id: number): Promise<Group | null> {
  const group = await db.query.groups.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  });
  if (!group) return null;

  const members = await db
    .select({
      userId: groupMembers.userId,
      email: users.email,
      name: users.name,
      createdAt: groupMembers.createdAt
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, id));

  return toGroup(
    group,
    members.map((m) => ({
      user_id: m.userId,
      email: m.email,
      name: m.name,
      created_at: toIso(m.createdAt)!
    }))
  );
}

export async function createGroup(input: GroupInput, actorUserId: number): Promise<Group> {
  const now = nowIso();

  const [row] = await db
    .insert(groups)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!row) throw new Error("Failed to create group");

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "group",
    entityId: row.id,
    summary: `Created group ${input.name}`
  });

  return (await getGroup(row.id))!;
}

export async function updateGroup(
  id: number,
  input: { name?: string; description?: string | null },
  actorUserId: number
): Promise<Group> {
  const existing = await db.query.groups.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  });
  if (!existing) throw new Error("Group not found");

  await db
    .update(groups)
    .set({
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      updatedAt: nowIso()
    })
    .where(eq(groups.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "group",
    entityId: id,
    summary: `Updated group ${input.name ?? existing.name}`
  });

  return (await getGroup(id))!;
}

export async function deleteGroup(id: number, actorUserId: number): Promise<void> {
  const existing = await db.query.groups.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  });
  if (!existing) throw new Error("Group not found");

  await db.delete(groups).where(eq(groups.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "group",
    entityId: id,
    summary: `Deleted group ${existing.name}`
  });
}

export async function addGroupMember(
  groupId: number,
  userId: number,
  actorUserId: number
): Promise<Group> {
  const group = await db.query.groups.findFirst({
    where: (table, operators) => operators.eq(table.id, groupId)
  });
  if (!group) throw new Error("Group not found");

  await db.insert(groupMembers).values({
    groupId,
    userId,
    createdAt: nowIso()
  });

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "group_member",
    entityId: groupId,
    summary: `Added user ${userId} to group ${group.name}`
  });

  return (await getGroup(groupId))!;
}

export async function removeGroupMember(
  groupId: number,
  userId: number,
  actorUserId: number
): Promise<Group> {
  const group = await db.query.groups.findFirst({
    where: (table, operators) => operators.eq(table.id, groupId)
  });
  if (!group) throw new Error("Group not found");

  const member = await db.query.groupMembers.findFirst({
    where: (table, operators) =>
      operators.and(
        operators.eq(table.groupId, groupId),
        operators.eq(table.userId, userId)
      )
  });
  if (!member) throw new Error("Member not found in group");

  await db.delete(groupMembers).where(eq(groupMembers.id, member.id));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "group_member",
    entityId: groupId,
    summary: `Removed user ${userId} from group ${group.name}`
  });

  return (await getGroup(groupId))!;
}

export async function getGroupsForUser(userId: number): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .select({ id: groups.id, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId));

  return rows;
}
