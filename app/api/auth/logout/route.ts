import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/src/lib/auth-server";
import { checkSameOrigin } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  await getAuth().api.signOut({ headers: await headers() });
  return NextResponse.redirect(new URL(`${config.basePath}/login`, config.baseUrl));
}
