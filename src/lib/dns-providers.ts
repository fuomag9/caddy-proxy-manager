import { encryptSecret, decryptSecret, isEncryptedSecret } from "./secret";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DnsProviderFieldType = "string" | "password";

export type DnsProviderField = {
  /** Key sent to Caddy config (e.g. "api_token") */
  key: string;
  /** Human-readable label */
  label: string;
  /** "password" fields are encrypted at rest */
  type: DnsProviderFieldType;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Help text shown below the input */
  description?: string;
  /** Whether the field is required */
  required: boolean;
};

export type DnsProviderDefinition = {
  /** Caddy DNS module name (e.g. "cloudflare", "route53") */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description?: string;
  /** Link to caddy-dns module docs */
  docsUrl?: string;
  /** Credential fields this provider requires */
  fields: DnsProviderField[];
  /** caddy-dns Go module path (for Dockerfile reference) */
  modulePath: string;
};

export type DnsProviderCredentials = {
  provider: string;
  credentials: Record<string, string>;
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const DNS_PROVIDERS: DnsProviderDefinition[] = [
  {
    name: "cloudflare",
    displayName: "Cloudflare",
    description: "Cloudflare DNS API",
    docsUrl: "https://github.com/caddy-dns/cloudflare",
    modulePath: "github.com/caddy-dns/cloudflare",
    fields: [
      {
        key: "api_token",
        label: "API Token",
        type: "password",
        required: true,
        placeholder: "Cloudflare API token with Zone:DNS:Edit permission",
      },
    ],
  },
  {
    name: "route53",
    displayName: "Amazon Route 53",
    description: "AWS Route 53 DNS API (supports IAM roles when fields are empty)",
    docsUrl: "https://github.com/caddy-dns/route53",
    modulePath: "github.com/caddy-dns/route53",
    fields: [
      { key: "access_key_id", label: "Access Key ID", type: "string", required: false, placeholder: "AKIA..." },
      { key: "secret_access_key", label: "Secret Access Key", type: "password", required: false },
      { key: "region", label: "AWS Region", type: "string", required: false, placeholder: "us-east-1" },
      {
        key: "hosted_zone_id",
        label: "Hosted Zone ID",
        type: "string",
        required: false,
        placeholder: "Z1234567890",
        description: "Optional. Required only if you have multiple zones for the same domain.",
      },
    ],
  },
  {
    name: "digitalocean",
    displayName: "DigitalOcean",
    description: "DigitalOcean DNS API",
    docsUrl: "https://github.com/caddy-dns/digitalocean",
    modulePath: "github.com/caddy-dns/digitalocean",
    fields: [
      { key: "api_token", label: "API Token", type: "password", required: true },
    ],
  },
  {
    name: "duckdns",
    displayName: "Duck DNS",
    description: "Duck DNS dynamic DNS service",
    docsUrl: "https://github.com/caddy-dns/duckdns",
    modulePath: "github.com/caddy-dns/duckdns",
    fields: [
      { key: "api_token", label: "Token", type: "password", required: true },
    ],
  },
  {
    name: "hetzner",
    displayName: "Hetzner",
    description: "Hetzner DNS API",
    docsUrl: "https://github.com/caddy-dns/hetzner",
    modulePath: "github.com/caddy-dns/hetzner",
    fields: [
      { key: "api_token", label: "API Token", type: "password", required: true },
    ],
  },
  {
    name: "vultr",
    displayName: "Vultr",
    description: "Vultr DNS API",
    docsUrl: "https://github.com/caddy-dns/vultr",
    modulePath: "github.com/caddy-dns/vultr",
    fields: [
      { key: "api_token", label: "API Key", type: "password", required: true },
    ],
  },
  {
    name: "porkbun",
    displayName: "Porkbun",
    description: "Porkbun DNS API",
    docsUrl: "https://github.com/caddy-dns/porkbun",
    modulePath: "github.com/caddy-dns/porkbun",
    fields: [
      { key: "api_key", label: "API Key", type: "password", required: true },
      { key: "api_secret_key", label: "API Secret Key", type: "password", required: true },
    ],
  },
  {
    name: "godaddy",
    displayName: "GoDaddy",
    description: "GoDaddy DNS API",
    docsUrl: "https://github.com/caddy-dns/godaddy",
    modulePath: "github.com/caddy-dns/godaddy",
    fields: [
      {
        key: "api_token",
        label: "API Key:Secret",
        type: "password",
        required: true,
        placeholder: "key:secret",
        description: "Format: API_KEY:API_SECRET",
      },
    ],
  },
  {
    name: "namecheap",
    displayName: "Namecheap",
    description: "Namecheap DNS API",
    docsUrl: "https://github.com/caddy-dns/namecheap",
    modulePath: "github.com/caddy-dns/namecheap",
    fields: [
      { key: "api_key", label: "API Key", type: "password", required: true },
      { key: "user", label: "Username", type: "string", required: true },
    ],
  },
  {
    name: "ovh",
    displayName: "OVH",
    description: "OVH DNS API",
    docsUrl: "https://github.com/caddy-dns/ovh",
    modulePath: "github.com/caddy-dns/ovh",
    fields: [
      { key: "endpoint", label: "Endpoint", type: "string", required: true, placeholder: "ovh-eu" },
      { key: "application_key", label: "Application Key", type: "string", required: true },
      { key: "application_secret", label: "Application Secret", type: "password", required: true },
      { key: "consumer_key", label: "Consumer Key", type: "password", required: true },
    ],
  },
  {
    name: "ionos",
    displayName: "IONOS",
    description: "IONOS DNS API",
    docsUrl: "https://github.com/caddy-dns/ionos",
    modulePath: "github.com/caddy-dns/ionos",
    fields: [
      { key: "auth_api_token", label: "API Token", type: "password", required: true, placeholder: "prefix.secret" },
    ],
  },
  {
    name: "linode",
    displayName: "Linode (Akamai)",
    description: "Linode/Akamai DNS API",
    docsUrl: "https://github.com/caddy-dns/linode",
    modulePath: "github.com/caddy-dns/linode",
    fields: [
      { key: "api_token", label: "API Token", type: "password", required: true },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getProviderDefinition(name: string): DnsProviderDefinition | undefined {
  return DNS_PROVIDERS.find((p) => p.name === name);
}

/**
 * Encrypt password-type credential fields for storage.
 * Non-password fields and already-encrypted values are left unchanged.
 */
export function encryptProviderCredentials(
  providerName: string,
  credentials: Record<string, string>
): Record<string, string> {
  const def = getProviderDefinition(providerName);
  if (!def) return credentials;

  const result = { ...credentials };
  for (const field of def.fields) {
    if (field.type === "password" && result[field.key] && !isEncryptedSecret(result[field.key])) {
      result[field.key] = encryptSecret(result[field.key]);
    }
  }
  return result;
}

/**
 * Decrypt password-type credential fields for use in Caddy config.
 */
export function decryptProviderCredentials(
  providerName: string,
  credentials: Record<string, string>
): Record<string, string> {
  const def = getProviderDefinition(providerName);
  if (!def) return credentials;

  const result = { ...credentials };
  for (const field of def.fields) {
    if (field.type === "password" && result[field.key] && isEncryptedSecret(result[field.key])) {
      result[field.key] = decryptSecret(result[field.key]);
    }
  }
  return result;
}

/**
 * Build the Caddy DNS challenge provider config from a provider name + credentials.
 * Returns the object to set as `issuer.challenges.dns`.
 */
export function buildDnsChallengeConfig(
  providerName: string,
  credentials: Record<string, string>,
  dnsResolvers: string[]
): Record<string, unknown> | null {
  const def = getProviderDefinition(providerName);
  if (!def) return null;

  const decrypted = decryptProviderCredentials(providerName, credentials);

  // Build provider config: { name: "cloudflare", api_token: "..." }
  const providerConfig: Record<string, string> = { name: providerName };
  for (const [key, value] of Object.entries(decrypted)) {
    if (value) {
      providerConfig[key] = value;
    }
  }

  const dnsChallenge: Record<string, unknown> = { provider: providerConfig };
  if (dnsResolvers.length > 0) {
    dnsChallenge.resolvers = dnsResolvers;
  }

  return dnsChallenge;
}
