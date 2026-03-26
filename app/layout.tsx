import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import Providers from "./providers";

function getNonce(csp: string | null): string | undefined {
  if (!csp) return undefined;
  const m = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  return m?.[1];
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const nonce = getNonce(h.get("Content-Security-Policy"));

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
