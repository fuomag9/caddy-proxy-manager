import { NextResponse } from 'next/server';
import { requireAdmin } from '@/src/lib/auth';
import { getAnalyticsHosts } from '@/src/lib/analytics-db';

export async function GET() {
  await requireAdmin();
  const hosts = await getAnalyticsHosts();
  return NextResponse.json(hosts);
}
