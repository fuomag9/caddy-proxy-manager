import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import {
  getForwardAuthAccessForHost,
  setForwardAuthAccess
} from "@/src/lib/models/forward-auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const access = await getForwardAuthAccessForHost(Number(id));
    return NextResponse.json(access);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const access = await setForwardAuthAccess(
      Number(id),
      { userIds: body.userIds, groupIds: body.groupIds },
      userId
    );
    return NextResponse.json(access);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
