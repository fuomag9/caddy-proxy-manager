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

    // C3: Validate expires_at before passing to createApiToken
    if (body.expires_at !== undefined && body.expires_at !== null && typeof body.expires_at !== "string") {
      return NextResponse.json({ error: "expires_at must be a string (ISO 8601 date)" }, { status: 400 });
    }

    let result;
    try {
      result = await createApiToken(body.name, userId, body.expires_at ?? undefined);
    } catch (e) {
      if (e instanceof Error && (e.message.includes("expires_at") || e.message.includes("ISO 8601"))) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    return NextResponse.json({ token: result.token, raw_token: result.rawToken }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
