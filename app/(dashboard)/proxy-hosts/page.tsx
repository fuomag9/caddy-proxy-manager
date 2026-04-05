import ProxyHostsClient from "./ProxyHostsClient";
import { listProxyHostsPaginated, countProxyHosts } from "@/src/lib/models/proxy-hosts";
import { listCertificates } from "@/src/lib/models/certificates";
import { listCaCertificates } from "@/src/lib/models/ca-certificates";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { getAuthentikSettings } from "@/src/lib/settings";
import { listMtlsRoles } from "@/src/lib/models/mtls-roles";
import { listIssuedClientCertificates } from "@/src/lib/models/issued-client-certificates";
import { listUsers } from "@/src/lib/models/user";
import { listGroups } from "@/src/lib/models/groups";
import { getForwardAuthAccessForHost } from "@/src/lib/models/forward-auth";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string; sortBy?: string; sortDir?: string }>;
}

export default async function ProxyHostsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam, sortBy: sortByParam, sortDir: sortDirParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;
  const sortBy = sortByParam || undefined;
  const sortDir = (sortDirParam === "asc" || sortDirParam === "desc") ? sortDirParam : "desc";

  const [hosts, total, certificates, caCertificates, accessLists, authentikDefaults] = await Promise.all([
    listProxyHostsPaginated(PER_PAGE, offset, search, sortBy, sortDir),
    countProxyHosts(search),
    listCertificates(),
    listCaCertificates(),
    listAccessLists(),
    getAuthentikSettings(),
  ]);
  // These are safe to fail if the RBAC migration hasn't been applied yet
  const [mtlsRoles, issuedClientCerts, allUsers, allGroups] = await Promise.all([
    listMtlsRoles().catch(() => []),
    listIssuedClientCertificates().catch(() => []),
    listUsers().catch(() => []),
    listGroups().catch(() => []),
  ]);

  // Build forward auth access map for hosts that have CPM forward auth enabled
  const faHosts = hosts.filter((h) => h.cpm_forward_auth?.enabled);
  const faAccessEntries = await Promise.all(
    faHosts.map((h) => getForwardAuthAccessForHost(h.id).catch(() => []))
  );
  const forwardAuthAccessMap: Record<number, { userIds: number[]; groupIds: number[] }> = {};
  faHosts.forEach((h, i) => {
    const entries = faAccessEntries[i];
    forwardAuthAccessMap[h.id] = {
      userIds: entries.filter((e) => e.user_id !== null).map((e) => e.user_id!),
      groupIds: entries.filter((e) => e.group_id !== null).map((e) => e.group_id!),
    };
  });

  const forwardAuthUsers = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
  }));
  const forwardAuthGroups = allGroups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    member_count: g.members.length,
  }));

  return (
    <ProxyHostsClient
      hosts={hosts}
      certificates={certificates}
      caCertificates={caCertificates}
      accessLists={accessLists}
      authentikDefaults={authentikDefaults}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
      initialSort={{ sortBy: sortBy ?? "created_at", sortDir }}
      mtlsRoles={mtlsRoles}
      issuedClientCerts={issuedClientCerts}
      forwardAuthUsers={forwardAuthUsers}
      forwardAuthGroups={forwardAuthGroups}
      forwardAuthAccessMap={forwardAuthAccessMap}
    />
  );
}
