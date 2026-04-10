import { NextRequest, NextResponse } from 'next/server';
import { requireApiAdmin, apiErrorResponse } from '@/src/lib/api-auth';
import { getAnalyticsHosts } from '@/src/lib/analytics-db';

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const hosts = await getAnalyticsHosts();
    return NextResponse.json(hosts);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
