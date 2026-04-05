import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getMtlsAccessRule, updateMtlsAccessRule, deleteMtlsAccessRule } from "@/src/lib/models/mtls-access-rules";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { ruleId } = await params;
    const rule = await getMtlsAccessRule(Number(ruleId));
    if (!rule) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rule);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { ruleId } = await params;
    const body = await request.json();
    const rule = await updateMtlsAccessRule(Number(ruleId), body, userId);
    return NextResponse.json(rule);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { ruleId } = await params;
    await deleteMtlsAccessRule(Number(ruleId), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
