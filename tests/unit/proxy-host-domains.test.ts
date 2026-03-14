import { describe, expect, it } from "vitest";
import { isValidProxyHostDomain, normalizeProxyHostDomains } from "@/src/lib/proxy-host-domains";

describe("isValidProxyHostDomain", () => {
  it("accepts standard hostnames", () => {
    expect(isValidProxyHostDomain("app.example.com")).toBe(true);
    expect(isValidProxyHostDomain("localhost")).toBe(true);
  });

  it("accepts wildcard hostnames on the left-most label", () => {
    expect(isValidProxyHostDomain("*.example.com")).toBe(true);
    expect(isValidProxyHostDomain("*.local")).toBe(true);
  });

  it("rejects wildcard hostnames outside the left-most label", () => {
    expect(isValidProxyHostDomain("api.*.example.com")).toBe(false);
    expect(isValidProxyHostDomain("*.*.example.com")).toBe(false);
    expect(isValidProxyHostDomain("example.*")).toBe(false);
  });

  it("accepts IP literals", () => {
    expect(isValidProxyHostDomain("192.168.1.10")).toBe(true);
    expect(isValidProxyHostDomain("2001:db8::1")).toBe(true);
  });
});

describe("normalizeProxyHostDomains", () => {
  it("normalizes case, strips trailing dots, and deduplicates domains", () => {
    expect(
      normalizeProxyHostDomains([" *.Example.com. ", "APP.EXAMPLE.COM", "*.example.com"])
    ).toEqual(["*.example.com", "app.example.com"]);
  });

  it("throws a helpful error for invalid wildcard placement", () => {
    expect(() => normalizeProxyHostDomains(["api.*.example.com"])).toThrow(
      'Invalid domain "api.*.example.com". Wildcards are supported only as the left-most label, for example "*.example.com".'
    );
  });
});
