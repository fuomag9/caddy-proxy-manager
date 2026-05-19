/**
 * Unified import entry point for proxy hosts.
 *
 * Auto-detects the input format (Caddyfile vs Caddy runtime JSON) from the
 * first non-whitespace character and dispatches to the matching pure parser.
 *
 * Both parsers emit the same `ImportResult` shape so the server action and UI
 * can stay format-agnostic.
 */

import {
  parseCaddyfile,
  type CaddyfileImportResult,
} from "./caddyfile-import";
import { parseCaddyJson } from "./caddy-json-import";

export type ImportFormat = "caddyfile" | "caddy-json";

export interface ProxyHostImportDraft {
  domains: string[];
  upstream: string;
  /** Defaults to false. Populated by the JSON parser when the upstream uses
   * Caddy's transport.tls.insecure_skip_verify. */
  skipHttpsHostnameValidation?: boolean;
  redirects?: { from: string; to: string; status: 301 | 302 | 307 | 308 }[];
  locationRules?: { path: string; upstreams: string[] }[];
  source: { format: ImportFormat; locator: string };
  warnings?: string[];
}

export interface ImportError {
  /** Human-readable location of the error, e.g. "lines 5-9" or "srv2.routes[12]" or "(root)". */
  locator: string;
  message: string;
  /** Optional offending snippet for display. */
  raw?: string;
}

export interface ImportSkipped {
  draft: ProxyHostImportDraft;
  reason: string;
}

export interface ImportResult {
  drafts: ProxyHostImportDraft[];
  errors: ImportError[];
  skipped: ImportSkipped[];
  format: ImportFormat;
}

function adaptCaddyfileResult(raw: CaddyfileImportResult): ImportResult {
  return {
    drafts: raw.drafts.map((d) => ({
      domains: d.domains,
      upstream: d.upstream,
      source: {
        format: "caddyfile" as const,
        locator: `lines ${d.lineStart}-${d.lineEnd}`,
      },
    })),
    errors: raw.errors.map((e) => ({
      locator: `lines ${e.lineStart}-${e.lineEnd}`,
      message: e.message,
      raw: e.raw,
    })),
    skipped: [],
    format: "caddyfile",
  };
}

export function parseProxyHostsImport(raw: string): ImportResult {
  // Strip a possible UTF-8 BOM and look at the first non-whitespace character.
  const cleaned = raw.replace(/^\uFEFF/, "").trimStart();
  if (cleaned.startsWith("{")) {
    return parseCaddyJson(cleaned);
  }
  return adaptCaddyfileResult(parseCaddyfile(raw));
}
