import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { deleteInstance, updateInstance } from "@/src/lib/models/instances";
import { instanceSyncTokenValidationError } from "@/src/lib/instance-sync-token";

/**
 * Update an instance's name, base URL, token or enabled flag; fields left out
 * are kept. Changing the token keeps the sync key pin; moving the instance to
 * a URL that reaches another slave endpoint releases it.
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
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const { name, baseUrl, apiToken, enabled } = body as Record<string, unknown>;
    if (apiToken !== undefined) {
      const tokenError = instanceSyncTokenValidationError(apiToken);
      if (tokenError) {
        return NextResponse.json({ error: tokenError }, { status: 400 });
      }
    }
    const instance = await updateInstance(
      Number(id),
      {
        name: name as string | undefined,
        baseUrl: baseUrl as string | undefined,
        apiToken: apiToken as string | undefined,
        enabled: enabled as boolean | undefined,
      },
      userId
    );
    return NextResponse.json(instance);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    await deleteInstance(Number(id), userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
