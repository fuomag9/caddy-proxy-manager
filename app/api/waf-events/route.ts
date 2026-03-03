import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/auth";
import { listWafEvents, countWafEvents } from "@/src/lib/models/waf-events";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get("per_page") ?? "50", 10) || 50));
    const search = searchParams.get("search")?.trim() || undefined;
    const offset = (page - 1) * perPage;

    const [events, total] = await Promise.all([
      listWafEvents(perPage, offset, search),
      countWafEvents(search),
    ]);

    return NextResponse.json({ events, total, page, perPage });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
