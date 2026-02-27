import AuditLogClient from "./AuditLogClient";
import { listAuditEvents, countAuditEvents } from "@/src/lib/models/audit";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 50;

interface PageProps {
  searchParams: { page?: string; search?: string };
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const search = searchParams.search?.trim() || undefined;
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
        created_at: event.created_at,
        summary: event.summary ?? `${event.action} on ${event.entity_type}`,
        user: event.user_id
          ? userMap.get(event.user_id)?.name ??
            userMap.get(event.user_id)?.email ??
            "System"
          : "System",
      }))}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
