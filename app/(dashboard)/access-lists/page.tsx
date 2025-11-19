import AccessListsClient from "./AccessListsClient";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { requireAdmin } from "@/src/lib/auth";

export default async function AccessListsPage() {
  await requireAdmin();
  const lists = await listAccessLists();
  return <AccessListsClient lists={lists} />;
}
