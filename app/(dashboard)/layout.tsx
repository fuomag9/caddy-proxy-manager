import type { ReactNode } from "react";
import { requireAdmin } from "@/src/lib/auth";
import DashboardLayoutClient from "./DashboardLayoutClient";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return <DashboardLayoutClient user={session.user}>{children}</DashboardLayoutClient>;
}
