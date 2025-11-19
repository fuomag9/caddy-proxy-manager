import DeadHostsClient from "./DeadHostsClient";
import { listDeadHosts } from "@/src/lib/models/dead-hosts";
import { requireAdmin } from "@/src/lib/auth";

export default async function DeadHostsPage() {
  await requireAdmin();
  const hosts = await listDeadHosts();
  return <DeadHostsClient hosts={hosts} />;
}
