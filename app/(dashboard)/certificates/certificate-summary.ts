import type { AcmeHost, CertExpiryStatus } from "./page";

export function countExpiry(statuses: (CertExpiryStatus | null)[]) {
  let expired = 0;
  let expiringSoon = 0;
  let healthy = 0;

  for (const status of statuses) {
    if (status === "expired") expired++;
    else if (status === "expiring_soon") expiringSoon++;
    else if (status === "ok") healthy++;
  }

  return { expired, expiringSoon, healthy };
}

export function countHealthyAcmeHosts(hosts: AcmeHost[]) {
  return hosts.filter((host) => host.enabled).length;
}
