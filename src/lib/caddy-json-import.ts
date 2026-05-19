/**
 * Pure parser for Caddy's runtime JSON config (the format returned by
 * `curl localhost:2019/config/`). Drilled into proxy-host drafts for CPM.
 *
 * The parser is pure and never throws on input; malformed inputs produce
 * `errors` entries.
 */

import type {
  ImportResult,
  ProxyHostImportDraft,
  ImportError,
  ImportSkipped,
} from "./proxy-hosts-import";

function emptyResult(): ImportResult {
  return {
    drafts: [],
    errors: [],
    skipped: [],
    format: "caddy-json",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCaddyJson(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse failed";
    return {
      ...emptyResult(),
      errors: [{ locator: "(root)", message: `Invalid JSON: ${message}` }],
    };
  }

  if (!isRecord(parsed)) {
    return {
      ...emptyResult(),
      errors: [{ locator: "(root)", message: "Root must be a JSON object" }],
    };
  }

  const apps = (parsed as Record<string, unknown>).apps;
  const http = isRecord(apps) ? apps.http : undefined;
  const servers = isRecord(http) ? (http as Record<string, unknown>).servers : undefined;

  if (!isRecord(servers)) {
    return {
      ...emptyResult(),
      errors: [
        {
          locator: "(root)",
          message: "Not a Caddy HTTP config: missing or invalid apps.http.servers",
        },
      ],
    };
  }

  const errors: ImportError[] = [];
  const skipped: ImportSkipped[] = [];

  // domain (lowercased) -> { port, draft } currently winning
  const winners = new Map<string, { port: number | null; draft: ProxyHostImportDraft }>();
  // Preserve insertion order for the final output.
  const winnerOrder: string[] = [];

  for (const [serverName, serverValue] of Object.entries(servers)) {
    if (!isRecord(serverValue)) continue;
    const routes = (serverValue as Record<string, unknown>).routes;
    if (!Array.isArray(routes)) continue;
    const listenArr = (serverValue as Record<string, unknown>).listen;
    const port = parsePort(Array.isArray(listenArr) ? listenArr[0] : undefined);

    routes.forEach((route, routeIndex) => {
      const locator = `${serverName}.routes[${routeIndex}]`;
      const extracted = extractDraftFromRoute(route, locator);
      if (extracted.kind === "error") {
        errors.push(extracted.error);
        return;
      }
      if (extracted.kind === "skip") {
        if (extracted.draft) skipped.push({ draft: extracted.draft, reason: extracted.reason });
        return;
      }
      // kind === "draft"
      const newDraft = extracted.draft;
      const key = newDraft.domains[0].toLowerCase();
      const existing = winners.get(key);
      if (!existing) {
        winners.set(key, { port, draft: newDraft });
        winnerOrder.push(key);
      } else if (existing.port !== 443 && port === 443) {
        skipped.push({
          draft: existing.draft,
          reason: `superseded by :${port} server`,
        });
        winners.set(key, { port, draft: newDraft });
      } else {
        const loserPort = existing.port ?? "?";
        skipped.push({
          draft: newDraft,
          reason: `superseded by :${loserPort} server`,
        });
      }
    });
  }

  const drafts: ProxyHostImportDraft[] = [];
  for (const key of winnerOrder) {
    const entry = winners.get(key);
    if (entry) drafts.push(entry.draft);
  }

  return { drafts, errors, skipped, format: "caddy-json" };
}

type RouteExtraction =
  | { kind: "draft"; draft: ProxyHostImportDraft }
  | { kind: "error"; error: ImportError }
  | { kind: "skip"; reason: string; draft?: ProxyHostImportDraft };

function extractDraftFromRoute(route: unknown, locator: string): RouteExtraction {
  if (!isRecord(route)) {
    return { kind: "error", error: { locator, message: "route is not an object" } };
  }

  const domains = extractDomains(route);
  if (domains.length === 0) {
    return { kind: "error", error: { locator, message: "route has no host matcher" } };
  }

  const handlers = collectHandlers(route);

  const warnings: string[] = [];
  for (const h of handlers) {
    if (h.handlerName === "headers") {
      warnings.push("Custom headers ignored; configure HSTS or preserveHostHeader in CPM.");
    } else if (h.handlerName === "authentication") {
      warnings.push("Authentication handler ignored; configure CPM Forward Auth or Authentik manually.");
    }
  }
  // Deduplicate warnings to keep the UI tidy.
  const uniqueWarnings = Array.from(new Set(warnings));

  const reverseProxies = handlers.filter((h) => h.handlerName === "reverse_proxy");
  if (reverseProxies.length === 0) {
    const placeholder: ProxyHostImportDraft = {
      domains,
      upstream: "",
      source: { format: "caddy-json", locator },
    };
    return { kind: "skip", reason: "no reverse_proxy handler", draft: placeholder };
  }

  // Primary: the first reverse_proxy without a path matcher. Fallback: the
  // very first reverse_proxy, in source order.
  const primary = reverseProxies.find((h) => !h.matchPath) ?? reverseProxies[0];
  const primaryUpstream = extractUpstream(primary.handler);
  if (!primaryUpstream) {
    return { kind: "error", error: { locator, message: "reverse_proxy has no usable upstream" } };
  }

  const locationRules: { path: string; upstreams: string[] }[] = [];
  for (const h of reverseProxies) {
    if (h === primary) continue;
    if (!h.matchPath) continue;
    const u = extractUpstream(h.handler);
    if (!u) continue;
    locationRules.push({ path: h.matchPath, upstreams: [u] });
  }

  const redirects: { from: string; to: string; status: 301 | 302 | 307 | 308 }[] = [];
  for (const h of handlers) {
    if (h.handlerName !== "static_response") continue;
    const status = h.handler.status_code;
    const headers = h.handler.headers;
    if (status !== 301 && status !== 302 && status !== 307 && status !== 308) continue;
    if (!isRecord(headers)) continue;
    const locationArr = (headers as Record<string, unknown>).Location;
    if (!Array.isArray(locationArr) || typeof locationArr[0] !== "string") continue;
    const from = h.matchPath;
    if (!from) continue;
    redirects.push({ from, to: locationArr[0], status });
  }

  const transport = primary.handler.transport;
  const tlsConfig = isRecord(transport) ? transport.tls : undefined;
  const hasTls = isRecord(tlsConfig);
  const skipVerify = hasTls && tlsConfig.insecure_skip_verify === true;

  const normalizedUpstream =
    hasTls && !/^https?:\/\//.test(primaryUpstream) ? `https://${primaryUpstream}` : primaryUpstream;

  const draft: ProxyHostImportDraft = {
    domains,
    upstream: normalizedUpstream,
    source: { format: "caddy-json", locator },
  };
  if (skipVerify) draft.skipHttpsHostnameValidation = true;
  if (redirects.length > 0) draft.redirects = redirects;
  if (locationRules.length > 0) draft.locationRules = locationRules;
  if (uniqueWarnings.length > 0) draft.warnings = uniqueWarnings;
  return { kind: "draft", draft };
}

function extractDomains(route: Record<string, unknown>): string[] {
  const match = route.match;
  if (!Array.isArray(match) || match.length === 0) return [];
  const first = match[0];
  if (!isRecord(first)) return [];
  const hosts = (first as Record<string, unknown>).host;
  if (!Array.isArray(hosts)) return [];
  return hosts.filter((h): h is string => typeof h === "string" && h.length > 0);
}

interface FlatHandler {
  handlerName: string;
  handler: Record<string, unknown>;
  /** Path matcher inherited from the surrounding inner route, if any. */
  matchPath?: string;
}

function collectHandlers(route: Record<string, unknown>): FlatHandler[] {
  const out: FlatHandler[] = [];
  walkHandle(route.handle, undefined, out);
  return out;
}

function walkHandle(
  handleValue: unknown,
  inheritedPath: string | undefined,
  out: FlatHandler[]
): void {
  if (!Array.isArray(handleValue)) return;
  for (const entry of handleValue) {
    if (!isRecord(entry)) continue;
    const handlerName = typeof entry.handler === "string" ? entry.handler : "";
    if (handlerName === "subroute") {
      const inner = (entry as Record<string, unknown>).routes;
      if (Array.isArray(inner)) {
        for (const innerRoute of inner) {
          if (!isRecord(innerRoute)) continue;
          const innerPath = extractFirstPath(innerRoute) ?? inheritedPath;
          walkHandle(innerRoute.handle, innerPath, out);
        }
      }
    } else if (handlerName) {
      out.push({ handlerName, handler: entry as Record<string, unknown>, matchPath: inheritedPath });
    }
  }
}

function extractFirstPath(innerRoute: Record<string, unknown>): string | undefined {
  const match = innerRoute.match;
  if (!Array.isArray(match)) return undefined;
  for (const m of match) {
    if (!isRecord(m)) continue;
    const path = (m as Record<string, unknown>).path;
    if (Array.isArray(path) && typeof path[0] === "string") return path[0];
  }
  return undefined;
}

function extractUpstream(handler: Record<string, unknown>): string | undefined {
  const upstreams = handler.upstreams;
  if (!Array.isArray(upstreams) || upstreams.length === 0) return undefined;
  const first = upstreams[0];
  if (!isRecord(first)) return undefined;
  const dial = (first as Record<string, unknown>).dial;
  return typeof dial === "string" && dial.length > 0 ? dial : undefined;
}

function parsePort(listen: unknown): number | null {
  if (typeof listen !== "string") return null;
  // Caddy listen entries look like ":443" or "0.0.0.0:443".
  const match = /:(\d+)$/.exec(listen);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
