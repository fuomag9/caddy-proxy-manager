import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth';
import { INTERVAL_SECONDS } from '@/src/lib/analytics-db';
import { countWafEventsInRange, getTopWafRules } from '@/src/lib/models/waf-events';

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
  await requireUser();
  const { from, to } = resolveRange(req.nextUrl.searchParams);
  const [total, topRules] = await Promise.all([
    countWafEventsInRange(from, to),
    getTopWafRules(from, to, 10),
  ]);
  return NextResponse.json({ total, topRules });
}
