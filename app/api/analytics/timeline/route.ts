import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth';
import { getAnalyticsTimeline, INTERVAL_SECONDS } from '@/src/lib/analytics-db';

export async function GET(req: NextRequest) {
  await requireUser();
  const { searchParams } = req.nextUrl;
  const host = searchParams.get('host') ?? 'all';
  const { from, to } = resolveRange(searchParams);
  const data = await getAnalyticsTimeline(from, to, host);
  return NextResponse.json(data);
}

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
