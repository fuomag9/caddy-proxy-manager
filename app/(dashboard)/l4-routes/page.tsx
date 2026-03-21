import L4RoutesClient from "./L4RoutesClient";
import { listL4RoutesPaginated, countL4Routes } from "@/src/lib/models/l4-routes";
import { listCertificates } from "@/src/lib/models/certificates";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export default async function L4RoutesPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const search = searchParam?.trim() || undefined;
  const offset = (page - 1) * PER_PAGE;

  const [routes, total, certificates] = await Promise.all([
    listL4RoutesPaginated(PER_PAGE, offset, search),
    countL4Routes(search),
    listCertificates(),
  ]);

  return (
    <L4RoutesClient
      routes={routes}
      certificates={certificates}
      pagination={{ total, page, perPage: PER_PAGE }}
      initialSearch={search ?? ""}
    />
  );
}
