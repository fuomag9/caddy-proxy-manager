import L4ProxyHostsClient from "./L4ProxyHostsClient";
import { listL4ProxyHostsPaginated, countL4ProxyHosts } from "@/src/lib/models/l4-proxy-hosts";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export default async function L4ProxyHostsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [hosts, total] = await Promise.all([
    listL4ProxyHostsPaginated(PER_PAGE, offset, search),
    countL4ProxyHosts(search),
  ]);

  return (
    <L4ProxyHostsClient
      hosts={hosts}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
