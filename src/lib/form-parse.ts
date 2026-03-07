/**
 * Pure FormData parsing utilities extracted from proxy-hosts/actions.ts.
 * No DB or network dependencies — safe to unit-test directly.
 */

export function parseCsv(value: FormDataEntryValue | null): string[] {
  if (!value || typeof value !== "string") return [];
  return value
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Parse upstreams by newline only (URLs may contain commas in query strings). */
export function parseUpstreams(value: FormDataEntryValue | null): string[] {
  if (!value || typeof value !== "string") return [];
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCheckbox(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export function parseOptionalText(value: FormDataEntryValue | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseCertificateId(value: FormDataEntryValue | null): number | null {
  if (!value || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

export function parseAccessListId(value: FormDataEntryValue | null): number | null {
  if (!value || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

export function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return num;
}
