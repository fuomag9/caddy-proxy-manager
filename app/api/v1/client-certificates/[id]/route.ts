import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getIssuedClientCertificate, revokeIssuedClientCertificate } from "@/src/lib/models/issued-client-certificates";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const cert = await getIssuedClientCertificate(Number(id));
    if (!cert) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(cert);
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
    const cert = await revokeIssuedClientCertificate(Number(id), userId);
    return NextResponse.json(cert);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
