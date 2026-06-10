import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, apiErrorResponse } from "@/src/lib/api-auth";
import { getCurrentSessionId } from "@/src/lib/auth";
import { listUserSessions, revokeOtherUserSessions } from "@/src/lib/models/sessions";

/** GET /api/v1/sessions — list the authenticated user's active sessions. */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireApiUser(request);
    const [list, currentId] = await Promise.all([
      listUserSessions(userId),
      getCurrentSessionId(request),
    ]);
    return NextResponse.json(list.map((s) => ({ ...s, current: s.id === currentId })));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** DELETE /api/v1/sessions — revoke all of the user's OTHER sessions. */
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireApiUser(request);
    const currentId = await getCurrentSessionId(request);
    const revoked = await revokeOtherUserSessions(userId, currentId);
    return NextResponse.json({ revoked });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
