import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { pinInstanceSyncKey, resetInstanceSyncKeyPin } from "@/src/lib/models/instances";

/**
 * Pin `{ publicKey }`, the slave's sync public key as the slave shows it, for
 * the instance, replacing any pin: the next sync seals to that key only.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const publicKey = (body as { publicKey?: unknown } | null)?.publicKey;
    return NextResponse.json(await pinInstanceSyncKey(Number(id), publicKey, userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Reset the instance's sync key pin: the next sync pins the key the slave presents. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    await resetInstanceSyncKeyPin(Number(id), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
