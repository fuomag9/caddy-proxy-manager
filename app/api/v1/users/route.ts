import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listUsers, createUser } from "@/src/lib/models/user";

function stripPasswordHash(user: Record<string, unknown>) {
  const { passwordHash: _, ...rest } = user;
  void _;
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

export async function POST(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const body = await request.json();

    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const name = body.name ? String(body.name).trim() : null;
    const role = ["admin", "user", "viewer"].includes(body.role) ? body.role : "user";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const bcrypt = await import("bcryptjs");
    const passwordHash = bcrypt.default.hashSync(password, 12);

    const user = await createUser({
      email,
      name,
      role,
      provider: "credential",
      subject: email,
      passwordHash,
    });

    return NextResponse.json(stripPasswordHash(user as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
