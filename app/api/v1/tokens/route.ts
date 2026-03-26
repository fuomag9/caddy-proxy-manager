import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, apiErrorResponse } from "@/src/lib/api-auth";
import { createApiToken, listApiTokens, listAllApiTokens } from "@/src/lib/models/api-tokens";

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireApiUser(request);
    const tokens = role === "admin" ? await listAllApiTokens() : await listApiTokens(userId);
    return NextResponse.json(tokens);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiUser(request);
    const body = await request.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { token, rawToken } = await createApiToken(body.name, userId, body.expires_at);
    return NextResponse.json({ token, raw_token: rawToken }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
