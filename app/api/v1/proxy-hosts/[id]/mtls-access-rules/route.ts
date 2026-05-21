import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listMtlsAccessRules, createMtlsAccessRule } from "@/src/lib/models/mtls-access-rules";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const rules = await listMtlsAccessRules(Number(id));
    return NextResponse.json(rules);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    if (!body.pathPattern || typeof body.pathPattern !== "string" || !body.pathPattern.trim()) {
      return NextResponse.json({ error: "pathPattern is required" }, { status: 400 });
    }
    const rule = await createMtlsAccessRule(
      { ...body, proxyHostId: Number(id) },
      userId
    );
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
