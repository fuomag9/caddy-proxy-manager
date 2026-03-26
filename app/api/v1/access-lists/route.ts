import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listAccessLists, createAccessList } from "@/src/lib/models/access-lists";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const lists = await listAccessLists();
    return NextResponse.json(lists);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();
    const list = await createAccessList(body, userId);
    return NextResponse.json(list, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
