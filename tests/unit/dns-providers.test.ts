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

  it("registers deSEC with the Caddy module path and API token field", () => {
    const provider = getProviderDefinition("desec");

    expect(provider).toMatchObject({
      name: "desec",
      displayName: "deSEC",
      docsUrl: "https://github.com/caddy-dns/desec",
      modulePath: "github.com/caddy-dns/desec",
    });
    expect(provider?.fields).toEqual([
      { key: "token", label: "API Token", type: "password", required: true },
    ]);
    expect(DNS_PROVIDERS.map((p) => p.name)).toContain("desec");
  });

  it("encrypts, decrypts, and emits deSEC credentials for Caddy DNS challenges", () => {
    const encrypted = encryptProviderCredentials("desec", {
      token: "desec-token",
    });

    expect(isEncryptedSecret(encrypted.token)).toBe(true);
    expect(decryptProviderCredentials("desec", encrypted)).toEqual({
      token: "desec-token",
    });
    expect(buildDnsChallengeConfig("desec", encrypted, ["1.1.1.1"])).toEqual({
      provider: {
        name: "desec",
        token: "desec-token",
      },
      resolvers: ["1.1.1.1"],
    });
  });

  it("registers Dynu with the Caddy module path and API token field", () => {
    const provider = getProviderDefinition("dynu");

    expect(provider).toMatchObject({
      name: "dynu",
      displayName: "Dynu",
      docsUrl: "https://github.com/caddy-dns/dynu",
      modulePath: "github.com/caddy-dns/dynu",
    });
    expect(provider?.fields).toEqual([
      { key: "api_token", label: "API Token", type: "password", required: true },
    ]);
    expect(DNS_PROVIDERS.map((p) => p.name)).toContain("dynu");
  });

  it("encrypts, decrypts, and emits Dynu credentials for Caddy DNS challenges", () => {
    const encrypted = encryptProviderCredentials("dynu", {
      api_token: "dynu-token",
    });

    expect(isEncryptedSecret(encrypted.api_token)).toBe(true);
    expect(decryptProviderCredentials("dynu", encrypted)).toEqual({
      api_token: "dynu-token",
    });
    expect(buildDnsChallengeConfig("dynu", encrypted, ["1.1.1.1"])).toEqual({
      provider: {
        name: "dynu",
        api_token: "dynu-token",
      },
      resolvers: ["1.1.1.1"],
    });
  });
});
