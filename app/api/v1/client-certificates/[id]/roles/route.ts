import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getCertificateRoles } from "@/src/lib/models/mtls-roles";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const roles = await getCertificateRoles(Number(id));
    return NextResponse.json(roles);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
