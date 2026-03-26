import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listIssuedClientCertificates, createIssuedClientCertificate } from "@/src/lib/models/issued-client-certificates";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const certs = await listIssuedClientCertificates();
    return NextResponse.json(certs);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();
    const cert = await createIssuedClientCertificate(body, userId);
    return NextResponse.json(cert, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
