import AuditLogClient from "./AuditLogClient";
import { listAuditEvents, countAuditEvents } from "@/src/lib/models/audit";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [events, total, users] = await Promise.all([
    listAuditEvents(PER_PAGE, offset, search),
    countAuditEvents(search),
    listUsers(),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));

  return (
    <AuditLogClient
      events={events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        user: event.userId
          ? userMap.get(event.userId)?.name ??
            userMap.get(event.userId)?.email ??
            "System"
          : "System",
      }))}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
