export const dynamic = 'force-dynamic';

import WafEventsClient from "./WafEventsClient";
import { listWafEvents, countWafEvents, getWafRuleMessages } from "@/src/lib/models/waf-events";
import { getWafSettings } from "@/src/lib/settings";
import { listProxyHosts } from "@/src/lib/models/proxy-hosts";
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

  const [events, total, globalWaf, hosts] = await Promise.all([
    listWafEvents(PER_PAGE, offset, search),
    countWafEvents(search),
    getWafSettings(),
    listProxyHosts(),
  ]);

  const globalExcludedIds = globalWaf?.excluded_rule_ids ?? [];
  const globalExcludedMessages = await getWafRuleMessages(globalExcludedIds);

  const hostWafMap: Record<string, number[]> = {};
  for (const host of hosts) {
    const ids = host.waf?.excluded_rule_ids ?? [];
    for (const domain of host.domains) {
      hostWafMap[domain] = ids;
    }
  }

  return (
    <WafEventsClient
      events={events}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      globalExcluded={globalExcludedIds}
      globalExcludedMessages={globalExcludedMessages}
      globalWafEnabled={globalWaf?.enabled ?? false}
      hostWafMap={hostWafMap}
    />
  );
}
