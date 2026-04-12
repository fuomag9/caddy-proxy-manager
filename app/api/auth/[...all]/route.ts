import { getAuth } from "@/src/lib/auth-server";
import { toNextJsHandler } from "better-auth/next-js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
