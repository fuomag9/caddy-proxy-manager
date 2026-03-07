/**
 * mTLS helper functions for building Caddy TLS connection policies.
 *
 * Extracted from caddy.ts so they can be unit-tested independently.
 */

/**
 * Converts a PEM certificate to base64-encoded DER format expected by Caddy's
 * `trusted_ca_certs` and `trusted_leaf_certs` fields.
 */
export function pemToBase64Der(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
}

/**
 * Builds a Caddy `client_authentication` block for the given list of domains.
 *
 * All CA cert IDs referenced by those domains are unioned into one set, which is
 * intentional when every domain in the list shares the same CA configuration.
 * Callers must ensure that `domains` is pre-grouped so domains with different CA
 * sets are passed in separate calls — see `groupMtlsDomainsByCaSet`.
 *
 * Strategy per CA:
 *  - Unmanaged CA (no tracked issued certs): trust any cert signed by that CA.
 *  - Managed CA with active certs: CA in `trusted_ca_certs` + active leaf certs
 *    in `trusted_leaf_certs` (revocation enforcement).
 *  - Managed CA with ALL certs revoked: excluded entirely (chain validation fails).
 *
 * Returns null if there are no CA certs to trust (all excluded or none configured).
 */
export function buildClientAuthentication(
  domains: string[],
  mTlsDomainMap: Map<string, number[]>,
  caCertMap: Map<number, { id: number; certificatePem: string }>,
  issuedClientCertMap: Map<number, string[]>,
  cAsWithAnyIssuedCerts: Set<number>
): Record<string, unknown> | null {
  const caCertIds = new Set<number>();
  for (const domain of domains) {
    const ids = mTlsDomainMap.get(domain.toLowerCase());
    if (ids) {
      for (const id of ids) caCertIds.add(id);
    }
  }
  if (caCertIds.size === 0) return null;

  const trustedCaCerts: string[] = [];
  const trustedLeafCerts: string[] = [];

  for (const id of caCertIds) {
    const ca = caCertMap.get(id);
    if (!ca) continue;

    if (cAsWithAnyIssuedCerts.has(id)) {
      // Managed CA: enforce revocation via leaf pinning
      const activeLeafCerts = issuedClientCertMap.get(id) ?? [];
      if (activeLeafCerts.length === 0) {
        // All certs revoked: exclude CA so chain validation fails for its certs
        continue;
      }
      trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
      for (const certPem of activeLeafCerts) {
        trustedLeafCerts.push(pemToBase64Der(certPem));
      }
    } else {
      // Unmanaged CA: trust any cert in the chain
      trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
    }
  }

  if (trustedCaCerts.length === 0) return null;

  const result: Record<string, unknown> = {
    mode: "require_and_verify",
    trusted_ca_certs: trustedCaCerts,
  };
  if (trustedLeafCerts.length > 0) result.trusted_leaf_certs = trustedLeafCerts;
  return result;
}

/**
 * Groups mTLS domains by their sorted CA ID fingerprint so that each group can
 * get its own TLS connection policy with the correct, isolated set of trusted CAs.
 *
 * Domains with the same set of CA IDs (regardless of order) are placed in the
 * same group.  Domains with different CA sets end up in separate groups, ensuring
 * a client certificate from CA_B cannot authenticate against a host that only
 * configured CA_A.
 *
 * @param domains - List of domain names that have mTLS configured.
 * @param mTlsDomainMap - Map from lowercased domain to its list of CA cert IDs.
 * @returns Map from CA-set fingerprint string to the list of domains sharing it.
 */
export function groupMtlsDomainsByCaSet(
  domains: string[],
  mTlsDomainMap: Map<string, number[]>
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const domain of domains) {
    const ids = mTlsDomainMap.get(domain.toLowerCase()) ?? [];
    const key = [...ids].sort((a, b) => a - b).join(",");
    const group = groups.get(key) ?? [];
    group.push(domain);
    groups.set(key, group);
  }
  return groups;
}
