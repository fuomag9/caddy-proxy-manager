import RedirectsClient from "./RedirectsClient";
import { listRedirectHosts } from "@/src/lib/models/redirect-hosts";
import { requireAdmin } from "@/src/lib/auth";

export default async function RedirectsPage() {
  await requireAdmin();
  const redirects = await listRedirectHosts();
  return <RedirectsClient redirects={redirects} />;
}
