import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { removeGroupMember } from "@/src/lib/models/groups";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { userId: actorUserId } = await requireApiAdmin(request);
    const { id, userId } = await params;
    const group = await removeGroupMember(Number(id), Number(userId), actorUserId);
    return NextResponse.json(group);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
