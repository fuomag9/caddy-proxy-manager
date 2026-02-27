import AccessListsClient from "./AccessListsClient";
import { listAccessListsPaginated, countAccessLists } from "@/src/lib/models/access-lists";
import { requireAdmin } from "@/src/lib/auth";

const PER_PAGE = 25;

interface PageProps {
  searchParams: { page?: string };
}

export default async function AccessListsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [lists, total] = await Promise.all([
    listAccessListsPaginated(PER_PAGE, offset),
    countAccessLists(),
  ]);

  return (
    <AccessListsClient
      lists={lists}
      pagination={{ total, page, perPage: PER_PAGE }}
    />
  );
}
