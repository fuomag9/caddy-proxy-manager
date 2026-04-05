import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getGroup, updateGroup, deleteGroup } from "@/src/lib/models/groups";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const group = await getGroup(Number(id));
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    return NextResponse.json(group);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const group = await updateGroup(Number(id), body, userId);
    return NextResponse.json(group);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    await deleteGroup(Number(id), userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
