import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { assignRoleToCertificate, getMtlsRole } from "@/src/lib/models/mtls-roles";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    if (!body.certificateId || typeof body.certificateId !== "number") {
      return NextResponse.json({ error: "certificateId is required" }, { status: 400 });
    }
    await assignRoleToCertificate(Number(id), body.certificateId, userId);
    const role = await getMtlsRole(Number(id));
    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
