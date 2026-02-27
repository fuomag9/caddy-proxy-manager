import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth';
import { getAnalyticsUserAgents, INTERVAL_SECONDS } from '@/src/lib/analytics-db';

export async function GET(req: NextRequest) {
  await requireUser();
  const { searchParams } = req.nextUrl;
  const hostsParam = searchParams.get('hosts') ?? '';
  const hosts = hostsParam ? hostsParam.split(',').filter(Boolean) : [];
  const { from, to } = resolveRange(searchParams);
  const data = await getAnalyticsUserAgents(from, to, hosts);
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
