export const dynamic = 'force-dynamic';

import WafEventsClient from "./WafEventsClient";
import { listWafEvents, countWafEvents, getWafEventStats, getWafRuleMessages } from "@/src/lib/models/waf-events";
import { getWafSettings } from "@/src/lib/settings";
import { listProxyHosts } from "@/src/lib/models/proxy-hosts";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 50;
const RANGE_SECONDS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
} as const;

type RangeKey = keyof typeof RANGE_SECONDS | 'all' | 'custom';

function parseRange(searchParams: { range?: string; from?: string; to?: string }): { range: RangeKey; from?: number; to?: number } {
  const rangeParam = searchParams.range;
  if (rangeParam === '24h' || rangeParam === '7d' || rangeParam === '30d') {
    const to = Math.floor(Date.now() / 1000);
    const from = to - RANGE_SECONDS[rangeParam];
    return { range: rangeParam, from, to };
  }

  if (rangeParam === 'custom') {
    const from = parseInt(searchParams.from ?? '', 10);
    const to = parseInt(searchParams.to ?? '', 10);
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      return { range: 'custom', from, to };
    }
  }

  return { range: 'all' };
}

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string; range?: string; from?: string; to?: string }>;
}

export default async function WafPage({ searchParams }: PageProps) {
  await requireAdmin();
  const resolvedSearchParams = await searchParams;
  const { page: pageParam, search: searchParam } = resolvedSearchParams;
  const { range, from, to } = parseRange(resolvedSearchParams);
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [events, total, stats, globalWaf, hosts] = await Promise.all([
    listWafEvents(PER_PAGE, offset, search, from, to),
    countWafEvents(search, from, to),
    getWafEventStats(search, from, to),
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
      stats={stats}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      initialRange={range}
      initialFrom={from ?? null}
      initialTo={to ?? null}
      globalExcluded={globalExcludedIds}
      globalExcludedMessages={globalExcludedMessages}
      globalWafEnabled={globalWaf?.enabled ?? false}
      hostWafMap={hostWafMap}
      globalWaf={globalWaf ?? null}
    />
  );
}
