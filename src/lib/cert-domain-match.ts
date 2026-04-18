/** Check if a domain is covered by any wildcard in the set (e.g. *.example.com covers sub.example.com) */
export function isDomainCoveredByWildcard(domain: string, wildcardDomains: string[]): boolean {
  for (const wc of wildcardDomains) {
    if (!wc.startsWith('*.')) continue;
    const base = wc.slice(2); // "example.com" from "*.example.com"
    // Exact base is not covered by wildcard alone (needs explicit entry)
    if (domain === base) continue;
    // Wildcard covers one level: sub.example.com but not sub.sub.example.com
    if (domain.endsWith('.' + base) && !domain.slice(0, -(base.length + 1)).includes('.')) {
      return true;
    }
  }
  return false;
}

/** Check if a domain is explicitly listed or covered by wildcard in a cert's domain list */
export function isDomainCoveredByCert(domain: string, certDomains: string[]): boolean {
  if (certDomains.includes(domain)) return true;
  return isDomainCoveredByWildcard(domain, certDomains);
}
