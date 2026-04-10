import { NextRequest, NextResponse } from 'next/server';
import { requireApiAdmin, apiErrorResponse } from '@/src/lib/api-auth';
import { getAnalyticsBlocked, INTERVAL_SECONDS } from '@/src/lib/analytics-db';

export async function GET(req: NextRequest) {
  try {
    await requireApiAdmin(req);
    const { searchParams } = req.nextUrl;
    const hostsParam = searchParams.get('hosts') ?? '';
    const hosts = hostsParam ? hostsParam.split(',').filter(Boolean) : [];
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const { from, to } = resolveRange(searchParams);
    const data = await getAnalyticsBlocked(from, to, hosts, page);
    return NextResponse.json(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
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
