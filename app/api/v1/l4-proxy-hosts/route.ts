import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listL4ProxyHosts, createL4ProxyHost } from "@/src/lib/models/l4-proxy-hosts";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const hosts = await listL4ProxyHosts();
    return NextResponse.json(hosts);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();
    const host = await createL4ProxyHost(body, userId);
    return NextResponse.json(host, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
