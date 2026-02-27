import ProxyHostsClient from "./ProxyHostsClient";
import { listProxyHostsPaginated, countProxyHosts } from "@/src/lib/models/proxy-hosts";
import { listCertificates } from "@/src/lib/models/certificates";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { getAuthentikSettings } from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: { page?: string };
}

export default async function ProxyHostsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [hosts, total, certificates, accessLists, authentikDefaults] = await Promise.all([
    listProxyHostsPaginated(PER_PAGE, offset),
    countProxyHosts(),
    listCertificates(),
    listAccessLists(),
    getAuthentikSettings(),
  ]);

  return (
    <ProxyHostsClient
      hosts={hosts}
      certificates={certificates}
      accessLists={accessLists}
      authentikDefaults={authentikDefaults}
      pagination={{ total, page, perPage: PER_PAGE }}
    />
  );
}
