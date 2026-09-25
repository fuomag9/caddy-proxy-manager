import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../helpers/db";

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock("../../src/lib/db", async () => {
  const { createTestDb } = await import("../helpers/db");
  const schemaModule = await import("../../src/lib/db/schema");
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock("../../src/lib/caddy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/caddy")>();
  return { ...actual, applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) };
});

vi.mock("../../src/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { createProxyHost } from "../../src/lib/models/proxy-hosts";
import { buildCaddyDocument } from "../../src/lib/caddy";
import { saveDefaultResponseSettings } from "../../src/lib/settings";
import {
  buildDefaultResponseRoute,
  normalizeDefaultResponseSettings,
} from "../../src/lib/caddy-default-response";
import * as schema from "../../src/lib/db/schema";

type CpmServer = { listen?: string[]; routes?: Array<Record<string, unknown>> };

function cpmServer(document: unknown): CpmServer | undefined {
  return (document as { apps?: { http?: { servers?: { cpm?: CpmServer } } } })
    .apps?.http?.servers?.cpm;
}

async function seedAdminAndHost() {
  const now = new Date().toISOString();
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    provider: "credentials",
    subject: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await createProxyHost(
    { name: "Known host", domains: ["known.example.test"], upstreams: ["10.0.0.5:8080"] },
    1
  );
}

beforeEach(async () => {
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.settings);
  await ctx.db.delete(schema.users);
});

describe("default response validation and route builder", () => {
  it("omits a route for Caddy's native default", () => {
    expect(buildDefaultResponseRoute(null)).toBeNull();
    expect(buildDefaultResponseRoute({ mode: "caddy" })).toBeNull();
  });

  it("builds custom response headers in Caddy's array-valued format", () => {
    expect(buildDefaultResponseRoute({
      mode: "respond",
      status: 418,
      body: "CPM_DEFAULT_RESPONSE",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Default": "yes" },
    })).toEqual({
      handle: [{
        handler: "static_response",
        status_code: 418,
        body: "CPM_DEFAULT_RESPONSE",
        headers: {
          "Content-Type": ["text/plain; charset=utf-8"],
          "X-Default": ["yes"],
        },
      }],
      terminal: true,
    });
  });

  it("uses Caddy's abort response for no-response mode", () => {
    expect(buildDefaultResponseRoute({ mode: "abort" })).toEqual({
      handle: [{ handler: "static_response", abort: true }],
      terminal: true,
    });
  });

  it("escapes host placeholders in body, headers and redirect target", () => {
    const respond = buildDefaultResponseRoute(normalizeDefaultResponseSettings({
      mode: "respond",
      status: 404,
      body: "{file./etc/hosts} {http.request.host}",
      headers: { "X-Info": "{env.HOME}" },
    }));
    const handler = respond!.handle[0] as { body: string; headers: Record<string, string[]> };
    expect(handler.body).toBe("\\{file./etc/hosts} {http.request.host}");
    expect(handler.headers["X-Info"]).toEqual(["\\{env.HOME}"]);

    const redirect = buildDefaultResponseRoute(normalizeDefaultResponseSettings({
      mode: "redirect",
      status: 308,
      redirectUrl: "https://example.com/{system.hostname}{http.request.uri}",
    }));
    const redirectHandler = redirect!.handle[0] as { headers: Record<string, string[]> };
    expect(redirectHandler.headers.Location).toEqual(["https://example.com/\\{system.hostname}{http.request.uri}"]);
  });

  it("builds redirects and gives Location precedence over custom headers", () => {
    const settings = normalizeDefaultResponseSettings({
      mode: "redirect",
      status: 308,
      redirectUrl: "https://example.com{http.request.uri}",
      headers: { location: "https://ignored.example", "Cache-Control": "no-store" },
    });
    expect(buildDefaultResponseRoute(settings)).toEqual({
      handle: [{
        handler: "static_response",
        status_code: 308,
        headers: {
          Location: ["https://example.com{http.request.uri}"],
          "Cache-Control": ["no-store"],
        },
      }],
      terminal: true,
    });
  });

  it("rejects invalid status codes and header injection", () => {
    expect(() => normalizeDefaultResponseSettings({ mode: "respond", status: 103 })).toThrow(/200 to 599/);
    expect(() => normalizeDefaultResponseSettings({
      mode: "respond",
      status: 404,
      headers: { "X-Test": "safe\r\nInjected: value" },
    })).toThrow(/Invalid value/);
    expect(() => normalizeDefaultResponseSettings({
      mode: "respond",
      headers: { "X-Test": "unsafe\u0000value" },
    })).toThrow(/Invalid value/);
    expect(() => normalizeDefaultResponseSettings({
      mode: "respond",
      headers: { "X-Test": "one", "x-test": "two" },
    })).toThrow(/Duplicate/);
    expect(() => normalizeDefaultResponseSettings({
      mode: "redirect",
      redirectUrl: "https://example.test/\u0000",
    })).toThrow(/control characters/);
  });
});

describe("buildCaddyDocument default response", () => {
  it("preserves the current no-server document when there are no hosts or setting", async () => {
    expect(cpmServer(await buildCaddyDocument())).toBeUndefined();
  });

  it("creates the HTTP server for a custom response even with zero proxy hosts", async () => {
    await saveDefaultResponseSettings({
      mode: "respond",
      status: 404,
      body: "Not Found",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

    const server = cpmServer(await buildCaddyDocument());
    expect(server?.listen).toEqual([":80"]);
    expect(server?.routes).toEqual([{
      handle: [{
        handler: "static_response",
        status_code: 404,
        body: "Not Found",
        headers: { "Content-Type": ["text/plain; charset=utf-8"] },
      }],
      terminal: true,
    }]);
  });

  it("keeps the matcher-less response last so a configured host still wins", async () => {
    await seedAdminAndHost();
    await saveDefaultResponseSettings({ mode: "respond", status: 403, body: "Forbidden" });

    const routes = cpmServer(await buildCaddyDocument())?.routes ?? [];
    expect(routes.length).toBeGreaterThan(1);
    expect(routes.slice(0, -1).every((route) => route.match !== undefined)).toBe(true);
    expect(JSON.stringify(routes.slice(0, -1))).toContain("known.example.test");
    expect(routes.at(-1)).toEqual({
      handle: [{ handler: "static_response", status_code: 403, body: "Forbidden" }],
      terminal: true,
    });
  });

  it("does not append a catch-all route when mode is reset to caddy", async () => {
    await seedAdminAndHost();
    await saveDefaultResponseSettings({ mode: "caddy" });

    const routes = cpmServer(await buildCaddyDocument())?.routes ?? [];
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.match !== undefined)).toBe(true);
    expect(JSON.stringify(routes)).toContain("known.example.test");
  });

  it("escapes host placeholders in path-block response bodies", async () => {
    await seedAdminAndHost();
    await createProxyHost(
      {
        name: "Blocked path host",
        domains: ["blocked.example.test"],
        upstreams: ["10.0.0.6:8080"],
        pathBlocks: [{ path: "/private/*", status: 403, body: "no {file./data/secret} {http.request.uri}" }],
      },
      1
    );

    const json = JSON.stringify(await buildCaddyDocument());
    expect(json).toContain(JSON.stringify("no \\{file./data/secret} {http.request.uri}").slice(1, -1));
    expect(json).not.toMatch(/[^\\]\{file\.\/data\/secret\}/);
  });
});
