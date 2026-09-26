import { escapeHostPlaceholders } from "./caddy-utils";

export type DefaultResponseMode = "caddy" | "respond" | "redirect" | "abort";

export type DefaultResponseSettings = {
  mode: DefaultResponseMode;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  redirectUrl?: string;
};

export type CaddyDefaultResponseRoute = {
  handle: Array<Record<string, unknown>>;
  terminal: true;
};

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class DefaultResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefaultResponseValidationError";
  }
}

function invalid(message: string): never {
  throw new DefaultResponseValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenControlCharacter(value: string, allowTab: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 127 || (code < 32 && (!allowTab || code !== 9))) return true;
  }
  return false;
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    invalid("Default response headers must be an object");
  }

  const headers: Record<string, string> = {};
  const seenNames = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim();
    if (!HEADER_NAME_PATTERN.test(name)) {
      invalid(`Invalid default response header name: ${rawName}`);
    }
    const foldedName = name.toLowerCase();
    if (seenNames.has(foldedName)) {
      invalid(`Duplicate default response header name: ${name}`);
    }
    if (typeof rawValue !== "string" || hasForbiddenControlCharacter(rawValue, true)) {
      invalid(`Invalid value for default response header: ${name}`);
    }
    seenNames.add(foldedName);
    headers[name] = rawValue.trim();
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Validate and canonicalize the persisted/API representation. Keeping this
 * strict prevents a bad setting from being saved and making Caddy reject every
 * subsequent configuration reload.
 */
export function normalizeDefaultResponseSettings(value: unknown): DefaultResponseSettings {
  if (!isRecord(value)) {
    invalid("Default response settings must be an object");
  }

  const mode = value.mode;
  if (mode !== "caddy" && mode !== "respond" && mode !== "redirect" && mode !== "abort") {
    invalid("Default response mode must be caddy, respond, redirect, or abort");
  }

  if (mode === "caddy" || mode === "abort") {
    return { mode };
  }

  const headers = normalizeHeaders(value.headers);

  if (mode === "redirect") {
    const status = value.status === undefined ? 302 : value.status;
    if (typeof status !== "number" || !Number.isInteger(status) || !REDIRECT_STATUSES.has(status)) {
      invalid("Default redirect status must be 301, 302, 303, 307, or 308");
    }
    if (
      typeof value.redirectUrl !== "string" ||
      value.redirectUrl.trim().length === 0 ||
      hasForbiddenControlCharacter(value.redirectUrl, false)
    ) {
      invalid("Default redirect URL is required and must not contain control characters");
    }
    return {
      mode,
      status,
      redirectUrl: value.redirectUrl.trim(),
      ...(headers ? { headers } : {}),
    };
  }

  const status = value.status === undefined ? 404 : value.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
    invalid("Default response status must be an integer from 200 to 599");
  }
  if (value.body !== undefined && typeof value.body !== "string") {
    invalid("Default response body must be a string");
  }

  return {
    mode,
    status,
    body: value.body ?? "",
    ...(headers ? { headers } : {}),
  };
}

function caddyHeaders(headers: Record<string, string> | undefined): Record<string, string[]> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, [escapeHostPlaceholders(value)]])
  );
}

/**
 * Build the final matcher-less route for CPM's main HTTP server.
 *
 * Request placeholders ({http.*}) in the body, header values and redirect
 * target are expanded by Caddy as usual; host placeholders ({env.*},
 * {system.*}, {file.*}) are escaped and served literally.
 */
export function buildDefaultResponseRoute(
  settings: DefaultResponseSettings | null | undefined
): CaddyDefaultResponseRoute | null {
  if (!settings || settings.mode === "caddy") return null;

  if (settings.mode === "abort") {
    return {
      handle: [{ handler: "static_response", abort: true }],
      terminal: true,
    };
  }

  const headers = caddyHeaders(settings.headers) ?? {};
  if (settings.mode === "redirect") {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "location") delete headers[name];
    }
    headers.Location = [escapeHostPlaceholders(settings.redirectUrl ?? "")];
  }

  const handler: Record<string, unknown> = {
    handler: "static_response",
    status_code: settings.status,
    ...(settings.mode === "respond" && settings.body ? { body: escapeHostPlaceholders(settings.body) } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };

  return { handle: [handler], terminal: true };
}
