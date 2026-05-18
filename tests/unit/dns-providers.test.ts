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
});
