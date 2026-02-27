import db, { toIso } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/auth";
import OverviewClient from "./OverviewClient";
import {
  accessLists,
  auditEvents,
  certificates,
  proxyHosts
} from "@/src/lib/db/schema";
import { count, desc } from "drizzle-orm";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SecurityIcon from "@mui/icons-material/Security";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import { ReactNode } from "react";
import { getAnalyticsSummary } from "@/src/lib/analytics-db";

type StatCard = {
  label: string;
  icon: ReactNode;
  count: number;
  href: string;
};

async function loadStats(): Promise<StatCard[]> {
  const [proxyHostCountResult, certificateCountResult, accessListCountResult] =
    await Promise.all([
      db.select({ value: count() }).from(proxyHosts),
      db.select({ value: count() }).from(certificates),
      db.select({ value: count() }).from(accessLists)
    ]);
  const proxyHostsCount = proxyHostCountResult[0]?.value ?? 0;
  const certificatesCount = certificateCountResult[0]?.value ?? 0;
  const accessListsCount = accessListCountResult[0]?.value ?? 0;

  return [
    { label: "Proxy Hosts", icon: <SwapHorizIcon fontSize="large" />, count: proxyHostsCount, href: "/proxy-hosts" },
    { label: "Certificates", icon: <SecurityIcon fontSize="large" />, count: certificatesCount, href: "/certificates" },
    { label: "Access Lists", icon: <VpnKeyIcon fontSize="large" />, count: accessListsCount, href: "/access-lists" }
  ];
}

export default async function OverviewPage() {
  const session = await requireAdmin();
  const [stats, trafficSummary, recentEventsRaw] = await Promise.all([
    loadStats(),
    getAnalyticsSummary(Math.floor(Date.now() / 1000) - 86400, Math.floor(Date.now() / 1000), []).catch(() => null),
    db
      .select({
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        summary: auditEvents.summary,
        createdAt: auditEvents.createdAt
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(8),
  ]);

  return (
    <OverviewClient
      userName={session.user.name ?? session.user.email ?? "Admin"}
      stats={stats}
      trafficSummary={trafficSummary}
      recentEvents={recentEventsRaw.map((event) => ({
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        created_at: toIso(event.createdAt)!
      }))}
    />
  );
}
