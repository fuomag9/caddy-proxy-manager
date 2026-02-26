import { NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth';
import { getAnalyticsHosts } from '@/src/lib/analytics-db';

export async function GET() {
  await requireUser();
  const hosts = await getAnalyticsHosts();
  return NextResponse.json(hosts);
}
