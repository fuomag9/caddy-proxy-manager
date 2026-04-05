import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getMtlsRole, updateMtlsRole, deleteMtlsRole } from "@/src/lib/models/mtls-roles";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const role = await getMtlsRole(Number(id));
    if (!role) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(role);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const role = await updateMtlsRole(Number(id), body, userId);
    return NextResponse.json(role);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    await deleteMtlsRole(Number(id), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
