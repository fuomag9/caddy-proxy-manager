/**
 * Pure parser for the minimal Caddyfile subset that CPM accepts as import input.
 *
 * Supported grammar (v1):
 *   File       := (Comment | Blank | SiteBlock)*
 *   SiteBlock  := DomainList "{" (Comment | Blank | ReverseProxy)* "}"
 *   DomainList := Domain ("," Domain)*
 *   ReverseProxy := "reverse_proxy" Upstream
 *
 * Any other directive inside a site block makes the whole block an error.
 * The parser never throws on input; malformed sections are returned as `errors`.
 */

export interface CaddyfileImportDraft {
  domains: string[];
  upstream: string;
  /** 1-based inclusive line number where the site block starts. */
  lineStart: number;
  /** 1-based inclusive line number where the site block ends. */
  lineEnd: number;
}

export interface CaddyfileImportError {
  lineStart: number;
  lineEnd: number;
  message: string;
  /** The offending block (or partial line) verbatim, for display in the UI. */
  raw: string;
}

export interface CaddyfileImportResult {
  drafts: CaddyfileImportDraft[];
  errors: CaddyfileImportError[];
}

type Line = { num: number; text: string; trimmed: string };

function tokenizeLines(raw: string): Line[] {
  const lines = raw.split(/\r?\n/);
  return lines.map((text, i) => ({ num: i + 1, text, trimmed: text.trim() }));
}

function isCommentOrBlank(trimmed: string): boolean {
  return trimmed.length === 0 || trimmed.startsWith('#');
}

function splitDomains(headerWithoutBrace: string): string[] {
  return headerWithoutBrace
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

function joinRaw(lines: Line[], start: number, end: number): string {
  return lines
    .slice(start - 1, end)
    .map((l) => l.text)
    .join('\n');
}

export function parseCaddyfile(raw: string): CaddyfileImportResult {
  const drafts: CaddyfileImportDraft[] = [];
  const errors: CaddyfileImportError[] = [];
  const cleaned = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const lines = tokenizeLines(cleaned);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isCommentOrBlank(line.trimmed)) {
      i++;
      continue;
    }

    // Site block header: either "<domains> {" or "<domains>" then next non-blank is "{".
    let headerText = line.trimmed;
    const lineStart = line.num;
    let cursor: number;

    if (headerText.endsWith('{')) {
      headerText = headerText.slice(0, -1).trim();
      cursor = i + 1;
    } else {
      // Look ahead for "{" on its own line, skipping blank/comment lines.
      let j = i + 1;
      while (j < lines.length && isCommentOrBlank(lines[j].trimmed)) j++;
      if (j < lines.length && lines[j].trimmed === '{') {
        cursor = j + 1;
      } else {
        const message = line.trimmed.includes('{')
          ? 'Single-line blocks are not supported; the closing "}" must be on its own line'
          : 'Expected "{" after domain list';
        errors.push({
          lineStart,
          lineEnd: line.num,
          message,
          raw: line.text,
        });
        i = i + 1;
        continue;
      }
    }

    const domains = splitDomains(headerText);
    if (domains.length === 0) {
      errors.push({
        lineStart,
        lineEnd: line.num,
        message: 'Empty domain list before "{"',
        raw: line.text,
      });
      // Skip to matching "}" or EOF.
      while (cursor < lines.length && lines[cursor].trimmed !== '}') cursor++;
      i = cursor + 1;
      continue;
    }

    // Body: collect directives until "}".
    const reverseProxyValues: string[] = [];
    const unsupported: { name: string; line: number }[] = [];
    let closed = false;
    let bodyEnd = cursor - 1;

    while (cursor < lines.length) {
      const bodyLine = lines[cursor];
      if (isCommentOrBlank(bodyLine.trimmed)) {
        cursor++;
        continue;
      }
      if (bodyLine.trimmed === '}') {
        closed = true;
        bodyEnd = bodyLine.num;
        cursor++;
        break;
      }
      // Tokenize: first word is the directive name.
      const tokens = bodyLine.trimmed.split(/\s+/);
      const name = tokens[0];
      if (name === 'reverse_proxy') {
        if (tokens.length > 2) {
          unsupported.push({ name: 'reverse_proxy (multi-upstream)', line: bodyLine.num });
        } else {
          reverseProxyValues.push(tokens[1] ?? '');
        }
      } else {
        unsupported.push({ name, line: bodyLine.num });
      }
      cursor++;
    }

    if (!closed) {
      errors.push({
        lineStart,
        lineEnd: lines.length,
        message: 'Site block is missing closing "}"',
        raw: joinRaw(lines, lineStart, lines.length),
      });
      i = lines.length;
      continue;
    }

    const lineEnd = bodyEnd;

    if (unsupported.length > 0) {
      const names = Array.from(new Set(unsupported.map((u) => u.name))).join(', ');
      errors.push({
        lineStart,
        lineEnd,
        message: `Unsupported directive(s) in site block: ${names}. Only "reverse_proxy" is supported.`,
        raw: joinRaw(lines, lineStart, lineEnd),
      });
      i = cursor;
      continue;
    }

    if (reverseProxyValues.length === 0) {
      errors.push({
        lineStart,
        lineEnd,
        message: 'Site block has no "reverse_proxy" directive',
        raw: joinRaw(lines, lineStart, lineEnd),
      });
      i = cursor;
      continue;
    }

    if (reverseProxyValues.length > 1) {
      errors.push({
        lineStart,
        lineEnd,
        message: `Site block has ${reverseProxyValues.length} "reverse_proxy" directives; only one is supported`,
        raw: joinRaw(lines, lineStart, lineEnd),
      });
      i = cursor;
      continue;
    }

    const upstream = reverseProxyValues[0];
    if (upstream.length === 0) {
      errors.push({
        lineStart,
        lineEnd,
        message: '"reverse_proxy" directive is missing an upstream',
        raw: joinRaw(lines, lineStart, lineEnd),
      });
      i = cursor;
      continue;
    }

    drafts.push({ domains, upstream, lineStart, lineEnd });
    i = cursor;
  }

  return { drafts, errors };
}
