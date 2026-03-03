import WafEventsClient from "./WafEventsClient";
import { listWafEvents, countWafEvents } from "@/src/lib/models/waf-events";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export default async function WafEventsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [events, total] = await Promise.all([
    listWafEvents(PER_PAGE, offset, search),
    countWafEvents(search),
  ]);

  return (
    <WafEventsClient
      events={events}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
