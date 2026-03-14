import { isIP } from "node:net";

const HOST_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidHostname(value: string) {
  if (!value || value.length > 253) {
    return false;
  }

  return value.split(".").every((label) => HOST_LABEL_REGEX.test(label));
}

export function isValidProxyHostDomain(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("*.")) {
    const baseDomain = normalized.slice(2);
    return !baseDomain.includes("*") && isValidHostname(baseDomain);
  }

  if (normalized.includes("*")) {
    return false;
  }

  return isIP(normalized) !== 0 || isValidHostname(normalized);
}

export function normalizeProxyHostDomains(domains: string[]) {
  const normalizedDomains = Array.from(
    new Set(
      domains
        .map((domain) => domain.trim().toLowerCase().replace(/\.$/, ""))
        .filter(Boolean)
    )
  );

  if (normalizedDomains.length === 0) {
    throw new Error("At least one domain must be specified");
  }

  const invalidDomain = normalizedDomains.find((domain) => !isValidProxyHostDomain(domain));
  if (invalidDomain) {
    throw new Error(
      `Invalid domain "${invalidDomain}". Wildcards are supported only as the left-most label, for example "*.example.com".`
    );
  }

  return normalizedDomains;
}
