import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { addAccessListEntry } from "@/src/lib/models/access-lists";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const list = await addAccessListEntry(Number(id), body, userId);
    return NextResponse.json(list, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
