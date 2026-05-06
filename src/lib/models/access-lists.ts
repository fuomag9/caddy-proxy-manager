import bcrypt from "bcryptjs";
import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { accessListEntries, accessLists, proxyHosts } from "../db/schema";
import { asc, eq, inArray, count } from "drizzle-orm";

export type AccessListEntry = {
  id: number;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type AccessList = {
  id: number;
  name: string;
  description: string | null;
  entries: AccessListEntry[];
  createdAt: string;
  updatedAt: string;
};

export type AccessListInput = {
  name: string;
  description?: string | null;
  users?: { username: string; password: string }[];
};

type AccessListRow = typeof accessLists.$inferSelect;
type AccessListEntryRow = typeof accessListEntries.$inferSelect;

function buildEntry(row: AccessListEntryRow): AccessListEntry {
  return {
    id: row.id,
    username: row.username,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

function toAccessList(row: AccessListRow, entries: AccessListEntryRow[]): AccessList {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    entries: entries
      .slice()
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(buildEntry),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listAccessLists(): Promise<AccessList[]> {
  const lists = await db.query.accessLists.findMany({
    orderBy: (table) => asc(table.name)
  });

  if (lists.length === 0) {
    return [];
  }

  const listIds = lists.map((list) => list.id);
  const entries = await db
    .select()
    .from(accessListEntries)
    .where(inArray(accessListEntries.accessListId, listIds));

  const entriesByList = new Map<number, AccessListEntryRow[]>();
  for (const entry of entries) {
    const bucket = entriesByList.get(entry.accessListId) ?? [];
    bucket.push(entry);
    entriesByList.set(entry.accessListId, bucket);
  }

  return lists.map((list) => toAccessList(list, entriesByList.get(list.id) ?? []));
}

export async function countAccessLists(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(accessLists);
  return row?.value ?? 0;
}

export async function listAccessListsPaginated(limit: number, offset: number): Promise<AccessList[]> {
  const lists = await db.query.accessLists.findMany({
    orderBy: (table) => asc(table.name),
    limit,
    offset,
  });

  if (lists.length === 0) return [];

  const listIds = lists.map((list) => list.id);
  const entries = await db
    .select()
    .from(accessListEntries)
    .where(inArray(accessListEntries.accessListId, listIds));

  const entriesByList = new Map<number, (typeof accessListEntries.$inferSelect)[]>();
  for (const entry of entries) {
    const bucket = entriesByList.get(entry.accessListId) ?? [];
    bucket.push(entry);
    entriesByList.set(entry.accessListId, bucket);
  }

  return lists.map((list) => toAccessList(list, entriesByList.get(list.id) ?? []));
}

export async function getAccessList(id: number): Promise<AccessList | null> {
  const list = await db.query.accessLists.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  });
  if (!list) {
    return null;
  }
  const entries = await db
    .select()
    .from(accessListEntries)
    .where(eq(accessListEntries.accessListId, id))
    .orderBy(asc(accessListEntries.username));
  return toAccessList(list, entries);
}

export async function createAccessList(input: AccessListInput, actorUserId: number) {
  const now = nowIso();

  const [accessList] = await db
    .insert(accessLists)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!accessList) {
    throw new Error("Failed to create access list");
  }

  if (input.users && input.users.length > 0) {
    await db.insert(accessListEntries).values(
      input.users.map((account) => ({
        accessListId: accessList.id,
        username: account.username,
        passwordHash: bcrypt.hashSync(account.password, 10),
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "access_list",
    entityId: accessList.id,
    summary: `Created access list ${input.name}`
  });

  await applyCaddyConfig();
  return (await getAccessList(accessList.id))!;
}

export async function updateAccessList(
  id: number,
  input: { name?: string; description?: string | null },
  actorUserId: number
) {
  const existing = await getAccessList(id);
  if (!existing) {
    throw new Error("Access list not found");
  }

  const now = nowIso();
  await db
    .update(accessLists)
    .set({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      updatedAt: now
    })
    .where(eq(accessLists.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "access_list",
    entityId: id,
    summary: `Updated access list ${input.name ?? existing.name}`
  });

  await applyCaddyConfig();
  return (await getAccessList(id))!;
}

export async function addAccessListEntry(
  accessListId: number,
  entry: { username: string; password: string },
  actorUserId: number
) {
  const list = await db.query.accessLists.findFirst({
    where: (table, operators) => operators.eq(table.id, accessListId)
  });
  if (!list) {
    throw new Error("Access list not found");
  }

  const now = nowIso();
  const hash = bcrypt.hashSync(entry.password, 10);
  await db.insert(accessListEntries).values({
    accessListId,
    username: entry.username,
    passwordHash: hash,
    createdAt: now,
    updatedAt: now
  });

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "access_list_entry",
    entityId: accessListId,
    summary: `Added user ${entry.username} to access list ${list.name}`
  });
  await applyCaddyConfig();
  return (await getAccessList(accessListId))!;
}

export async function removeAccessListEntry(accessListId: number, entryId: number, actorUserId: number) {
  const list = await db.query.accessLists.findFirst({
    where: (table, operators) => operators.eq(table.id, accessListId)
  });
  if (!list) {
    throw new Error("Access list not found");
  }

  await db.delete(accessListEntries).where(eq(accessListEntries.id, entryId));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "access_list_entry",
    entityId: entryId,
    summary: `Removed entry from access list ${list.name}`
  });
  await applyCaddyConfig();
  return (await getAccessList(accessListId))!;
}

export async function deleteAccessList(id: number, actorUserId: number) {
  const existing = await db.query.accessLists.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  });
  if (!existing) {
    throw new Error("Access list not found");
  }

  await db.delete(accessLists).where(eq(accessLists.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "access_list",
    entityId: id,
    summary: `Deleted access list ${existing.name}`
  });
  await applyCaddyConfig();
}

export type AccessListUsage = {
  id: number;
  name: string;
  domains: string[];
  enabled: boolean;
};

export async function getAccessListUsageMap(): Promise<Map<number, AccessListUsage[]>> {
  const rows = await db
    .select({
      id: proxyHosts.id,
      name: proxyHosts.name,
      domains: proxyHosts.domains,
      enabled: proxyHosts.enabled,
      accessListId: proxyHosts.accessListId,
    })
    .from(proxyHosts);

  const map = new Map<number, AccessListUsage[]>();
  for (const row of rows) {
    if (row.accessListId == null) continue;
    const bucket = map.get(row.accessListId) ?? [];
    bucket.push({
      id: row.id,
      name: row.name,
      domains: JSON.parse(row.domains),
      enabled: row.enabled,
    });
    map.set(row.accessListId, bucket);
  }
  return map;
}
