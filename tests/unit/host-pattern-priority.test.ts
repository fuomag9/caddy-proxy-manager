import { describe, expect, it } from "vitest";
import {
  compareHostPatterns,
  groupHostPatternsByPriority,
  sortAutomationPoliciesBySubjectPriority,
  sortRoutesByHostPriority,
  sortTlsPoliciesBySniPriority,
} from "@/src/lib/host-pattern-priority";

describe("compareHostPatterns", () => {
  it("puts exact hosts ahead of same-level wildcards", () => {
    expect(compareHostPatterns("api.example.com", "*.example.com")).toBeLessThan(0);
  });

  it("puts deeper patterns ahead of broader ones", () => {
    expect(compareHostPatterns("foo.sub.example.com", "foo.example.com")).toBeLessThan(0);
    expect(compareHostPatterns("*.sub.example.com", "*.example.com")).toBeLessThan(0);
  });
});

describe("groupHostPatternsByPriority", () => {
  it("splits exact and wildcard domains into deterministic priority groups", () => {
    expect(
      groupHostPatternsByPriority([
        "*.example.com",
        "admin.example.com",
        "*.sub.example.com",
        "api.example.com",
      ])
    ).toEqual([
      ["admin.example.com", "api.example.com"],
      ["*.sub.example.com"],
      ["*.example.com"],
    ]);
  });
});

describe("sortRoutesByHostPriority", () => {
  it("orders exact routes before matching wildcard routes", () => {
    const routes = sortRoutesByHostPriority([
      { match: [{ host: ["*.example.com"] }], id: "wildcard" },
      { match: [{ host: ["api.example.com"] }], id: "exact" },
    ]);

    expect(routes.map((route) => (route as { id: string }).id)).toEqual(["exact", "wildcard"]);
  });

  it("keeps path-specific routes ahead of catch-all routes for the same host group", () => {
    const routes = sortRoutesByHostPriority([
      { match: [{ host: ["api.example.com"] }], id: "catch-all" },
      { match: [{ host: ["api.example.com"], path: ["/auth/*"] }], id: "path" },
    ]);

    expect(routes.map((route) => (route as { id: string }).id)).toEqual(["path", "catch-all"]);
  });
});

describe("sortTlsPoliciesBySniPriority", () => {
  it("orders exact SNI policies before same-level wildcard SNI policies", () => {
    const policies = sortTlsPoliciesBySniPriority([
      { match: { sni: ["*.example.com"] }, id: "wildcard" },
      { match: { sni: ["api.example.com"] }, id: "exact" },
    ]);

    expect(policies.map((policy) => (policy as { id: string }).id)).toEqual(["exact", "wildcard"]);
  });
});

describe("sortAutomationPoliciesBySubjectPriority", () => {
  it("orders exact automation subjects before wildcard subjects", () => {
    const policies = sortAutomationPoliciesBySubjectPriority([
      { subjects: ["*.example.com"], id: "wildcard" },
      { subjects: ["api.example.com"], id: "exact" },
    ]);

    expect(policies.map((policy) => (policy as { id: string }).id)).toEqual(["exact", "wildcard"]);
  });
});
