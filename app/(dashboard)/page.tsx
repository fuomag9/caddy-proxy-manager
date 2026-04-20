import db, { toIso } from "@/src/lib/db";
import { requireUser } from "@/src/lib/auth";
import OverviewClient from "./OverviewClient";
import {
  accessLists,
  auditEvents,
  certificates,
  proxyHosts
} from "@/src/lib/db/schema";
import { count, desc, isNull, sql } from "drizzle-orm";
import { ArrowLeftRight, ShieldCheck, KeyRound } from "lucide-react";
import { ReactNode } from "react";
import { getAnalyticsSummary } from "@/src/lib/analytics-db";
import { isDomainCoveredByCert } from "@/src/lib/cert-domain-match";

type StatCard = {
  label: string;
  icon: ReactNode;
  count: number;
  href: string;
};

async function loadStats(): Promise<StatCard[]> {
  const [proxyHostCountResult, acmeRows, certRows, importedCertCountResult, accessListCountResult] =
    await Promise.all([
      db.select({ value: count() }).from(proxyHosts),
      // All proxy hosts with no explicit cert (for ACME deduplication)
      db.select({ domains: proxyHosts.domains }).from(proxyHosts).where(isNull(proxyHosts.certificateId)),
      // All certs (for wildcard coverage check)
      db.select({ id: certificates.id, type: certificates.type, domainNames: certificates.domainNames, certificatePem: certificates.certificatePem }).from(certificates),
      // Imported certs with actual PEM data (valid, user-managed)
      db.select({ value: count() }).from(certificates).where(
        sql`${certificates.type} = 'imported' AND ${certificates.certificatePem} IS NOT NULL`
      ),
      db.select({ value: count() }).from(accessLists)
    ]);

  // Build cert domain map for wildcard coverage checks
  const certDomainMap = new Map<number, string[]>();
  for (const cert of certRows) {
    certDomainMap.set(cert.id, JSON.parse(cert.domainNames) as string[]);
  }

  // Deduplicate ACME hosts: remove those covered by a cert's wildcard or another ACME wildcard
  const acmeHostDomains = acmeRows.map(r => JSON.parse(r.domains) as string[]);
  const wildcardAcmeDomainSets = acmeHostDomains.filter(domains => domains.some((d: string) => d.startsWith('*.')));

  let acmeCount = 0;
  for (const domains of acmeHostDomains) {
    // Check if covered by an existing certificate's wildcard
    let covered = false;
    for (const [, certDomains] of certDomainMap) {
      if (domains.every((d: string) => isDomainCoveredByCert(d, certDomains))) {
        covered = true;
        break;
      }
    }
    // Check if this non-wildcard host is covered by a wildcard ACME host
    if (!covered && !domains.some((d: string) => d.startsWith('*.'))) {
      covered = wildcardAcmeDomainSets.some(wcDomains =>
        domains.every((d: string) => isDomainCoveredByCert(d, wcDomains))
      );
    }
    if (!covered) acmeCount++;
  }

  const proxyHostsCount = proxyHostCountResult[0]?.value ?? 0;
  const certificatesCount = acmeCount + (importedCertCountResult[0]?.value ?? 0);
  const accessListsCount = accessListCountResult[0]?.value ?? 0;

  return [
    { label: "Proxy Hosts", icon: <ArrowLeftRight className="h-4 w-4" />, count: proxyHostsCount, href: "/proxy-hosts" },
    { label: "Certificates", icon: <ShieldCheck className="h-4 w-4" />, count: certificatesCount, href: "/certificates" },
    { label: "Access Lists", icon: <KeyRound className="h-4 w-4" />, count: accessListsCount, href: "/access-lists" }
  ];
}

export default async function OverviewPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "admin";

  // Non-admin users see a minimal welcome page
  if (!isAdmin) {
    return (
      <OverviewClient
        userName={session.user.name ?? session.user.email ?? "User"}
        stats={[]}
        trafficSummary={null}
        recentEvents={[]}
        isAdmin={false}
      />
    );
  }

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
      isAdmin={true}
      recentEvents={recentEventsRaw.map((event) => ({
        summary: event.summary ?? `${event.action} on ${event.entityType}`,
        createdAt: toIso(event.createdAt)!
      }))}
    />
  );
}
