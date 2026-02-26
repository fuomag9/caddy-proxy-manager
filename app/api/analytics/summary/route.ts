import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth';
import { getAnalyticsSummary, type Interval } from '@/src/lib/analytics-db';

export async function GET(req: NextRequest) {
  await requireUser();
  const { searchParams } = req.nextUrl;
  const interval = (searchParams.get('interval') ?? '24h') as Interval;
  const host = searchParams.get('host') ?? 'all';
  const data = await getAnalyticsSummary(interval, host);
  return NextResponse.json(data);
}
