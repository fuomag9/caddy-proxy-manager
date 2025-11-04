import { signOut } from "@/src/lib/auth";

export const dynamic = 'force-dynamic';

export async function POST() {
  await signOut({ redirectTo: "/login" });
}
