import { describe, expect, it } from "vitest";
import {
  DNS_PROVIDERS,
  buildDnsChallengeConfig,
  decryptProviderCredentials,
  encryptProviderCredentials,
  getProviderDefinition,
} from "@/src/lib/dns-providers";
import { isEncryptedSecret } from "@/src/lib/secret";

describe("DNS provider registry", () => {
  it("registers Njalla with the Caddy module path and API token field", () => {
    const provider = getProviderDefinition("njalla");

    expect(provider).toMatchObject({
      name: "njalla",
      displayName: "Njalla",
      docsUrl: "https://github.com/caddy-dns/njalla",
      modulePath: "github.com/caddy-dns/njalla",
    });
    expect(provider?.fields).toEqual([
      {
        key: "api_token",
        label: "API Token",
        type: "password",
        required: true,
      },
    ]);
    expect(DNS_PROVIDERS.map((p) => p.name)).toContain("njalla");
  });

  it("encrypts, decrypts, and emits Njalla credentials for Caddy DNS challenges", () => {
    const encrypted = encryptProviderCredentials("njalla", {
      api_token: "njalla-token",
    });

    expect(isEncryptedSecret(encrypted.api_token)).toBe(true);
    expect(decryptProviderCredentials("njalla", encrypted)).toEqual({
      api_token: "njalla-token",
    });
    expect(buildDnsChallengeConfig("njalla", encrypted, ["1.1.1.1"])).toEqual({
      provider: {
        name: "njalla",
        api_token: "njalla-token",
      },
      resolvers: ["1.1.1.1"],
    });
  });

  it("registers Spaceship with the Caddy module path and API key/secret fields", () => {
    const provider = getProviderDefinition("spaceship");

    expect(provider).toMatchObject({
      name: "spaceship",
      displayName: "Spaceship",
      docsUrl: "https://github.com/caddy-dns/spaceship",
      modulePath: "github.com/caddy-dns/spaceship",
    });
    expect(provider?.fields).toEqual([
      { key: "api_key", label: "API Key", type: "password", required: true },
      { key: "api_secret", label: "API Secret", type: "password", required: true },
    ]);
    expect(DNS_PROVIDERS.map((p) => p.name)).toContain("spaceship");
  });

  it("encrypts, decrypts, and emits Spaceship credentials for Caddy DNS challenges", () => {
    const encrypted = encryptProviderCredentials("spaceship", {
      api_key: "spaceship-key",
      api_secret: "spaceship-secret",
    });

    expect(isEncryptedSecret(encrypted.api_key)).toBe(true);
    expect(isEncryptedSecret(encrypted.api_secret)).toBe(true);
    expect(decryptProviderCredentials("spaceship", encrypted)).toEqual({
      api_key: "spaceship-key",
      api_secret: "spaceship-secret",
    });
    expect(buildDnsChallengeConfig("spaceship", encrypted, ["1.1.1.1"])).toEqual({
      provider: {
        name: "spaceship",
        api_key: "spaceship-key",
        api_secret: "spaceship-secret",
      },
      resolvers: ["1.1.1.1"],
    });
  });
});
