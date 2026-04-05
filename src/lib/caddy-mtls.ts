/**
 * mTLS helper functions for building Caddy TLS connection policies
 * and HTTP-layer RBAC route enforcement.
 *
 * Extracted from caddy.ts so they can be unit-tested independently.
 */

/**
 * Normalise a fingerprint to the format Caddy uses:
 * lowercase hex without colons.
 *
 * Node's X509Certificate.fingerprint256 returns "AB:CD:EF:..." (uppercase, colons).
 * Caddy's {http.request.tls.client.fingerprint} returns "abcdef..." (lowercase, no colons).
 */
export function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, "").toLowerCase();
}

/**
 * Minimal type matching MtlsAccessRule from the models layer.
 * Defined here to avoid importing from models (which pulls in db.ts).
 */
export type MtlsAccessRuleLike = {
  path_pattern: string;
  allowed_role_ids: number[];
  allowed_cert_ids: number[];
  deny_all: boolean;
};

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
  cAsWithAnyIssuedCerts: Set<number>,
  mTlsDomainLeafOverride?: Map<string, string[]>
): Record<string, unknown> | null {
  const caCertIds = new Set<number>();
  for (const domain of domains) {
    const ids = mTlsDomainMap.get(domain.toLowerCase());
    if (ids) {
      for (const id of ids) caCertIds.add(id);
    }
  }
  if (caCertIds.size === 0) return null;

  // Check if any domain in this group uses the new cert-based model (has leaf override)
  const leafOverridePems = new Set<string>();
  let hasLeafOverride = false;
  if (mTlsDomainLeafOverride) {
    for (const domain of domains) {
      const pems = mTlsDomainLeafOverride.get(domain.toLowerCase());
      if (pems) {
        hasLeafOverride = true;
        for (const pem of pems) leafOverridePems.add(pem);
      }
    }
  }

  const trustedCaCerts: string[] = [];
  const trustedLeafCerts: string[] = [];

  if (hasLeafOverride) {
    // New cert-based model: CAs were derived from selected certs.
    // Add CAs for chain validation, pin to only the explicitly selected leaf certs.
    for (const id of caCertIds) {
      const ca = caCertMap.get(id);
      if (ca) trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
    }
    for (const pem of leafOverridePems) {
      trustedLeafCerts.push(pemToBase64Der(pem));
    }
  } else {
    // Legacy CA-based model
    for (const id of caCertIds) {
      const ca = caCertMap.get(id);
      if (!ca) continue;

      if (cAsWithAnyIssuedCerts.has(id)) {
        const activeLeafCerts = issuedClientCertMap.get(id) ?? [];
        trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
        if (activeLeafCerts.length === 0) {
          // All certs revoked — pin to the CA cert itself as a leaf cert.
          // No client cert can hash-match a CA cert, so this rejects all
          // clients while keeping a valid client_authentication block
          // (avoids relying on Caddy's experimental "drop" field).
          // Note: presenting the CA cert as a client cert would require the
          // CA's private key, which is already a full compromise scenario.
          trustedLeafCerts.push(pemToBase64Der(ca.certificatePem));
        } else {
          for (const certPem of activeLeafCerts) {
            trustedLeafCerts.push(pemToBase64Der(certPem));
          }
        }
      } else {
        trustedCaCerts.push(pemToBase64Der(ca.certificatePem));
      }
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

// ── mTLS RBAC HTTP-layer route enforcement ───────────────────────────

/**
 * For a single access rule, resolve the set of allowed fingerprints by unioning:
 *  - All active cert fingerprints from certs that hold any of the allowed roles
 *  - All active cert fingerprints from directly-allowed cert IDs
 */
export function resolveAllowedFingerprints(
  rule: MtlsAccessRuleLike,
  roleFingerprintMap: Map<number, Set<string>>,
  certFingerprintMap: Map<number, string>
): Set<string> {
  const allowed = new Set<string>();

  for (const roleId of rule.allowed_role_ids) {
    const fps = roleFingerprintMap.get(roleId);
    if (fps) {
      for (const fp of fps) allowed.add(fp);
    }
  }

  for (const certId of rule.allowed_cert_ids) {
    const fp = certFingerprintMap.get(certId);
    if (fp) allowed.add(fp);
  }

  return allowed;
}

/**
 * Builds a CEL expression that checks whether the client certificate's
 * fingerprint is in the given set of allowed fingerprints.
 *
 * Uses Caddy's `{http.request.tls.client.fingerprint}` placeholder.
 */
export function buildFingerprintCelExpression(fingerprints: Set<string>): string {
  const fps = Array.from(fingerprints).sort();
  const quoted = fps.map((fp) => `'${fp}'`).join(", ");
  return `{http.request.tls.client.fingerprint} in [${quoted}]`;
}

/**
 * Given a proxy host's mTLS access rules, builds subroutes that enforce
 * path-based RBAC at the HTTP layer (after TLS handshake).
 *
 * Returns null if there are no access rules (caller should use normal routing).
 *
 * The returned subroutes:
 *  - For each rule (ordered by priority desc), emit a path+fingerprint match
 *    route (allow) followed by a path-only route (deny 403).
 *  - After all rules, a catch-all route allows any valid cert (preserving
 *    backwards-compatible behavior for paths without rules).
 */
export function buildMtlsRbacSubroutes(
  accessRules: MtlsAccessRuleLike[],
  roleFingerprintMap: Map<number, Set<string>>,
  certFingerprintMap: Map<number, string>,
  baseHandlers: Record<string, unknown>[],
  reverseProxyHandler: Record<string, unknown>
): Record<string, unknown>[] | null {
  if (accessRules.length === 0) return null;

  const subroutes: Record<string, unknown>[] = [];

  // Rules are already sorted by priority desc, path asc
  for (const rule of accessRules) {
    if (rule.deny_all) {
      // Explicit deny: any request matching this path gets 403
      subroutes.push({
        match: [{ path: [rule.path_pattern] }],
        handle: [{
          handler: "static_response",
          status_code: "403",
          body: "mTLS access denied",
        }],
        terminal: true,
      });
      continue;
    }

    const allowedFps = resolveAllowedFingerprints(rule, roleFingerprintMap, certFingerprintMap);

    if (allowedFps.size === 0) {
      // Rule exists but no certs match → deny all for this path
      subroutes.push({
        match: [{ path: [rule.path_pattern] }],
        handle: [{
          handler: "static_response",
          status_code: "403",
          body: "mTLS access denied",
        }],
        terminal: true,
      });
      continue;
    }

    // Allow route: path + fingerprint CEL match
    const celExpr = buildFingerprintCelExpression(allowedFps);
    subroutes.push({
      match: [{ path: [rule.path_pattern], expression: celExpr }],
      handle: [...baseHandlers, reverseProxyHandler],
      terminal: true,
    });

    // Deny route: path matches but fingerprint didn't → 403
    subroutes.push({
      match: [{ path: [rule.path_pattern] }],
      handle: [{
        handler: "static_response",
        status_code: "403",
        body: "mTLS access denied",
      }],
      terminal: true,
    });
  }

  // Catch-all: paths without explicit rules → any valid cert gets through
  subroutes.push({
    handle: [...baseHandlers, reverseProxyHandler],
    terminal: true,
  });

  return subroutes;
}

