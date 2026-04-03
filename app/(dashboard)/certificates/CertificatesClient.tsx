"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import type { AcmeHost, CaCertificateView, CertExpiryStatus, ImportedCertView, ManagedCertView } from "./page";
import { StatusSummaryBar } from "./components/StatusSummaryBar";
import { AcmeTab } from "./components/AcmeTab";
import { ImportedTab } from "./components/ImportedTab";
import { CaTab } from "./components/CaTab";

type TabId = "acme" | "imported" | "ca";

type Props = {
  acmeHosts: AcmeHost[];
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  caCertificates: CaCertificateView[];
  acmePagination: { total: number; page: number; perPage: number };
};

function countExpiry(statuses: (CertExpiryStatus | null)[]) {
  let expired = 0, expiringSoon = 0, healthy = 0;
  for (const s of statuses) {
    if (s === "expired") expired++;
    else if (s === "expiring_soon") expiringSoon++;
    else if (s === "ok") healthy++;
  }
  return { expired, expiringSoon, healthy };
}

export default function CertificatesClient({
  acmeHosts,
  importedCerts,
  managedCerts,
  caCertificates,
  acmePagination,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("acme");
  const [searchAcme, setSearchAcme] = useState("");
  const [searchImported, setSearchImported] = useState("");
  const [searchCa, setSearchCa] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const allStatuses: (CertExpiryStatus | null)[] = [
    ...importedCerts.map((c) => c.expiryStatus),
  ];
  const { expired, expiringSoon, healthy } = countExpiry(allStatuses);

  const search = activeTab === "acme" ? searchAcme : activeTab === "imported" ? searchImported : searchCa;
  const setSearch = activeTab === "acme" ? setSearchAcme : activeTab === "imported" ? setSearchImported : setSearchCa;

  function handleTabChange(value: string) {
    setActiveTab(value as TabId);
    setStatusFilter(null);
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="SSL/TLS Certificates"
        description="Caddy automatically handles HTTPS certificates via Let's Encrypt. Import custom certificates only when needed."
      />

      {/* Status summary filter chips */}
      <StatusSummaryBar
        expired={expired}
        expiringSoon={expiringSoon}
        healthy={healthy}
        filter={statusFilter}
        onFilter={setStatusFilter}
      />

      {/* Tabs + search row */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <TabsList className="w-fit">
            <TabsTrigger value="acme" className="gap-1.5">
              ACME
              <span className="rounded-full bg-muted px-1.5 py-0 text-xs font-bold tabular-nums">
                {acmePagination.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="imported" className="gap-1.5">
              Imported
              <span className="rounded-full bg-muted px-1.5 py-0 text-xs font-bold tabular-nums">
                {importedCerts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="ca" className="gap-1.5">
              CA / mTLS
              <span className="rounded-full bg-muted px-1.5 py-0 text-xs font-bold tabular-nums">
                {caCertificates.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <SearchField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              activeTab === "acme"
                ? "Search by host or domain…"
                : activeTab === "imported"
                  ? "Search by name or domain…"
                  : "Search by name…"
            }
            className="sm:max-w-xs"
            aria-label="search"
          />
        </div>

        <TabsContent value="acme" className="mt-4">
          <AcmeTab
            acmeHosts={acmeHosts}
            acmePagination={acmePagination}
            search={searchAcme}
            statusFilter={statusFilter}
          />
        </TabsContent>
        <TabsContent value="imported" className="mt-4">
          <ImportedTab
            importedCerts={importedCerts}
            managedCerts={managedCerts}
            search={searchImported}
            statusFilter={statusFilter}
          />
        </TabsContent>
        <TabsContent value="ca" className="mt-4">
          <CaTab
            caCertificates={caCertificates}
            search={searchCa}
            statusFilter={statusFilter}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
