import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { removeRoleFromCertificate } from "@/src/lib/models/mtls-roles";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id, certId } = await params;
    await removeRoleFromCertificate(Number(id), Number(certId), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
