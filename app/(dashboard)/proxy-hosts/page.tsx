import ProxyHostsClient from "./ProxyHostsClient";
import { listProxyHosts } from "@/src/lib/models/proxy-hosts";
import { listCertificates } from "@/src/lib/models/certificates";
import { listAccessLists } from "@/src/lib/models/access-lists";
import { getAuthentikSettings } from "@/src/lib/settings";
import { requireAdmin } from "@/src/lib/auth";

export default async function ProxyHostsPage() {
  await requireAdmin();
  const [hosts, certificates, accessLists, authentikDefaults] = await Promise.all([
    listProxyHosts(),
    listCertificates(),
    listAccessLists(),
    getAuthentikSettings()
  ]);

  return <ProxyHostsClient hosts={hosts} certificates={certificates} accessLists={accessLists} authentikDefaults={authentikDefaults} />;
}
