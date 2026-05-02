import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listWafEvents, countWafEvents } from "@/src/lib/models/waf-events";

const RANGE_SECONDS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
} as const;

function resolveRange(searchParams: URLSearchParams): { from?: number; to?: number } {
  const range = searchParams.get('range');
  if (range === '24h' || range === '7d' || range === '30d') {
    const to = Math.floor(Date.now() / 1000);
    const from = to - RANGE_SECONDS[range];
    return { from, to };
  }

  if (range === 'custom') {
    const from = parseInt(searchParams.get('from') ?? '', 10);
    const to = parseInt(searchParams.get('to') ?? '', 10);
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      return { from, to };
    }
  }

  return {};
}

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get("per_page") ?? "50", 10) || 50));
    const search = searchParams.get("search")?.trim() || undefined;
    const { from, to } = resolveRange(searchParams);
    const offset = (page - 1) * perPage;

    const [events, total] = await Promise.all([
      listWafEvents(perPage, offset, search, from, to),
      countWafEvents(search, from, to),
    ]);

    return NextResponse.json({ events, total, page, perPage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
