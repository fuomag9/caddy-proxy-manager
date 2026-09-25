const isDev = process.env.NODE_ENV === "development";

/** Build the nonce-based policy used by authenticated application pages. */
export function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}'`,
    // style-src still needs 'unsafe-inline' for React JSX inline style props
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // maplibre-gl loads its tile worker from a same-origin bundled asset.
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ];
  return directives.join("; ");
}
