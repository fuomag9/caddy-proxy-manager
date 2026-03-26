import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { removeAccessListEntry } from "@/src/lib/models/access-lists";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id, entryId } = await params;
    const list = await removeAccessListEntry(Number(id), Number(entryId), userId);
    return NextResponse.json(list);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
