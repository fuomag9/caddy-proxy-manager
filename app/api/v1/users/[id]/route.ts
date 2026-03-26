import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireApiAdmin, apiErrorResponse, ApiAuthError } from "@/src/lib/api-auth";
import { getUserById, updateUserProfile } from "@/src/lib/models/user";

function stripPasswordHash(user: Record<string, unknown>) {
  const { password_hash, ...rest } = user;
  return rest;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiUser(request);
    const { id } = await params;
    const targetId = Number(id);

    // Non-admins can only view themselves
    if (auth.role !== "admin" && auth.userId !== targetId) {
      throw new ApiAuthError("Forbidden", 403);
    }

    const user = await getUserById(targetId);
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(stripPasswordHash(user as unknown as Record<string, unknown>));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const user = await updateUserProfile(Number(id), body);
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(stripPasswordHash(user as unknown as Record<string, unknown>));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
