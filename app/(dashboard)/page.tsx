import db, { toIso } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/auth";
import OverviewClient from "./OverviewClient";
import {
  accessLists,
  auditEvents,
  certificates,
  deadHosts,
  proxyHosts,
  redirectHosts
} from "@/src/lib/db/schema";
import { count, desc } from "drizzle-orm";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TurnRightIcon from "@mui/icons-material/TurnRight";
import BlockIcon from "@mui/icons-material/Block";
import SecurityIcon from "@mui/icons-material/Security";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { ReactNode } from "react";

type StatCard = {
  label: string;
  icon: ReactNode;
  count: number;
  href: string;
};

async function loadStats(): Promise<StatCard[]> {
  const [proxyHostCountResult, redirectHostCountResult, deadHostCountResult, certificateCountResult, accessListCountResult] =
    await Promise.all([
      db.select({ value: count() }).from(proxyHosts),
      db.select({ value: count() }).from(redirectHosts),
      db.select({ value: count() }).from(deadHosts),
      db.select({ value: count() }).from(certificates),
      db.select({ value: count() }).from(accessLists)
    ]);
  const proxyHostsCount = proxyHostCountResult[0]?.value ?? 0;
  const redirectHostsCount = redirectHostCountResult[0]?.value ?? 0;
  const deadHostsCount = deadHostCountResult[0]?.value ?? 0;
  const certificatesCount = certificateCountResult[0]?.value ?? 0;
  const accessListsCount = accessListCountResult[0]?.value ?? 0;

  return [
    { label: "Proxy Hosts", icon: <SwapHorizIcon fontSize="large" />, count: proxyHostsCount, href: "/proxy-hosts" },
    { label: "Redirects", icon: <TurnRightIcon fontSize="large" />, count: redirectHostsCount, href: "/redirects" },
    { label: "Dead Hosts", icon: <BlockIcon fontSize="large" />, count: deadHostsCount, href: "/dead-hosts" },
    { label: "Certificates", icon: <SecurityIcon fontSize="large" />, count: certificatesCount, href: "/certificates" },
    { label: "Access Lists", icon: <VpnKeyIcon fontSize="large" />, count: accessListsCount, href: "/access-lists" }
  ];
}

export default async function OverviewPage() {
  const session = await requireAdmin();
  const stats = await loadStats();
  const recentEvents = await db
    .select({
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      summary: auditEvents.summary,
      createdAt: auditEvents.createdAt
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(8);

  return (
    <OverviewClient
      userName={session.user.name ?? session.user.email ?? "Admin"}
      stats={stats}
      recentEvents={recentEvents.map((event) => ({
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        created_at: toIso(event.createdAt)!
      }))}
    />
  );
}
