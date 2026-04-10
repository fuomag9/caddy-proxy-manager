import { NextRequest, NextResponse } from 'next/server';
import { requireApiAdmin, apiErrorResponse } from '@/src/lib/api-auth';
import { INTERVAL_SECONDS } from '@/src/lib/analytics-db';
import { countWafEventsInRange, getTopWafRulesWithHosts, getWafEventCountries } from '@/src/lib/models/waf-events';

function resolveRange(params: URLSearchParams): { from: number; to: number } {
  const fromParam = params.get('from');
  const toParam = params.get('to');
  if (fromParam && toParam) {
    return { from: parseInt(fromParam, 10), to: parseInt(toParam, 10) };
  }
  const interval = params.get('interval') ?? '1h';
  const to = Math.floor(Date.now() / 1000);
  const from = to - (INTERVAL_SECONDS[interval as keyof typeof INTERVAL_SECONDS] ?? INTERVAL_SECONDS['1h']);
  return { from, to };
}

export async function GET(req: NextRequest) {
  try {
    await requireApiAdmin(req);
    const { from, to } = resolveRange(req.nextUrl.searchParams);
    const [total, topRules, byCountry] = await Promise.all([
      countWafEventsInRange(from, to),
      getTopWafRulesWithHosts(from, to, 10),
      getWafEventCountries(from, to),
    ]);
    return NextResponse.json({ total, topRules, byCountry });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
