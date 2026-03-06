"use client";

import { Box, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useState } from "react";
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
  let expired = 0;
  let expiringSoon = 0;
  let healthy = 0;
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

  // Aggregate expiry counts across all cert types
  const allStatuses: (CertExpiryStatus | null)[] = [
    ...acmeHosts.map((h) => h.certExpiryStatus),
    ...importedCerts.map((c) => c.expiryStatus),
  ];
  const { expired, expiringSoon, healthy } = countExpiry(allStatuses);

  const search = activeTab === "acme" ? searchAcme : activeTab === "imported" ? searchImported : searchCa;
  const setSearch =
    activeTab === "acme" ? setSearchAcme : activeTab === "imported" ? setSearchImported : setSearchCa;

  function handleTabChange(_: React.SyntheticEvent, value: TabId) {
    setActiveTab(value);
    setStatusFilter(null);
  }

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      {/* Page header */}
      <Stack spacing={1}>
        <Typography variant="h4" fontWeight={600}>
          SSL/TLS Certificates
        </Typography>
        <Typography color="text.secondary">
          Caddy automatically handles HTTPS certificates for all proxy hosts using Let&apos;s Encrypt.
          Import custom certificates only when needed (internal CA, special requirements, etc.).
        </Typography>
      </Stack>

      {/* Status summary bar */}
      <StatusSummaryBar
        expired={expired}
        expiringSoon={expiringSoon}
        healthy={healthy}
        filter={statusFilter}
        onFilter={setStatusFilter}
      />

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab
            label={`ACME (${acmePagination.total})`}
            value="acme"
          />
          <Tab
            label={`Imported (${importedCerts.length})`}
            value="imported"
          />
          <Tab
            label={`CA / mTLS (${caCertificates.length})`}
            value="ca"
          />
        </Tabs>
      </Box>

      {/* Per-tab search */}
      <TextField
        placeholder={
          activeTab === "acme"
            ? "Search by host name or domain…"
            : activeTab === "imported"
              ? "Search by name or domain…"
              : "Search by name…"
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ maxWidth: 400 }}
        inputProps={{ "aria-label": "search" }}
      />

      {/* Tab panels */}
      {activeTab === "acme" && (
        <AcmeTab
          acmeHosts={acmeHosts}
          acmePagination={acmePagination}
          search={searchAcme}
          statusFilter={statusFilter}
        />
      )}
      {activeTab === "imported" && (
        <ImportedTab
          importedCerts={importedCerts}
          managedCerts={managedCerts}
          search={searchImported}
          statusFilter={statusFilter}
        />
      )}
      {activeTab === "ca" && (
        <CaTab
          caCertificates={caCertificates}
          search={searchCa}
          statusFilter={statusFilter}
        />
      )}
    </Stack>
  );
}
