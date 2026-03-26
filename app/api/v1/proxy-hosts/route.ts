import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listProxyHosts, createProxyHost } from "@/src/lib/models/proxy-hosts";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const hosts = await listProxyHosts();
    return NextResponse.json(hosts);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();
    const host = await createProxyHost(body, userId);
    return NextResponse.json(host, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
