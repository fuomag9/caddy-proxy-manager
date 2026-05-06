import AccessListsClient from "./AccessListsClient";
import { listAccessLists, getAccessListUsageMap } from "@/src/lib/models/access-lists";
import { requireAdmin } from "@/src/lib/auth";

export default async function AccessListsPage() {
  await requireAdmin();

  const [lists, usageMap] = await Promise.all([
    listAccessLists(),
    getAccessListUsageMap(),
  ]);

  // Serialize usage map to a plain object for client
  const usage: Record<number, { id: number; name: string; domains: string[]; enabled: boolean }[]> = {};
  for (const [listId, hosts] of usageMap) {
    usage[listId] = hosts;
  }

  return <AccessListsClient lists={lists} usage={usage} />;
}
