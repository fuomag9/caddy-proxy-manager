import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listUsers } from "@/src/lib/models/user";

function stripPasswordHash(user: Record<string, unknown>) {
  const { password_hash, ...rest } = user;
  return rest;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const users = await listUsers();
    return NextResponse.json(users.map(u => stripPasswordHash(u as unknown as Record<string, unknown>)));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
