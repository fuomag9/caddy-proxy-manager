import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, apiErrorResponse } from "@/src/lib/api-auth";
import { revokeUserSession } from "@/src/lib/models/sessions";

/** DELETE /api/v1/sessions/[id] — revoke one of the user's own sessions. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiUser(request);
    const { id } = await params;
    const sessionId = Number(id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    const revoked = await revokeUserSession(userId, sessionId);
    if (!revoked) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
