import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import {
  listForwardAuthSessions,
  deleteUserForwardAuthSessions
} from "@/src/lib/models/forward-auth";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const sessions = await listForwardAuthSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
    }
    await deleteUserForwardAuthSessions(Number(userId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
