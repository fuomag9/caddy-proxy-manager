import { NextRequest } from "next/server";
import { signOut, checkSameOrigin } from "@/src/lib/auth";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;
  await signOut({ redirectTo: "/login" });
}
