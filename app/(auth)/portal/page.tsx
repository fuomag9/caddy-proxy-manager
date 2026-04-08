import { cookies } from "next/headers";
import { auth } from "@/src/lib/auth";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import { isForwardAuthDomain, createRedirectIntent } from "@/src/lib/models/forward-auth";
import PortalLoginForm from "./PortalLoginForm";

interface PortalPageProps {
  searchParams: Promise<{ rid?: string }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  // After OAuth callback, the portal is loaded with ?rid= (the opaque ID we created earlier)
  const existingRid = params.rid ?? "";

  // Read redirect URI from HttpOnly cookie set by Caddy, then clear it
  const cookieStore = await cookies();
  const redirectUri = cookieStore.get("_cpm_rd")?.value ?? "";
  if (redirectUri) {
    cookieStore.delete("_cpm_rd");
  }

  // Two entry modes:
  // 1. Fresh from Caddy redirect: _cpm_rd cookie → validate, store server-side, create rid
  // 2. Returning from OAuth: ?rid=<opaque-id> → reuse the existing rid (redirect already stored)
  let targetDomain = "";
  let rid = existingRid;
  if (!rid && redirectUri) {
    try {
      const parsed = new URL(redirectUri);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        await isForwardAuthDomain(parsed.hostname)
      ) {
        targetDomain = parsed.hostname;
        // Store the redirect URI server-side. The client only gets an opaque ID,
        // so a tampered cookie cannot influence the final redirect target.
        rid = await createRedirectIntent(redirectUri);
      }
    } catch {
      // invalid URL — portal will show a generic message
    }
  }

  const session = await auth();
  const enabledProviders = getEnabledOAuthProviders();

  return (
    <PortalLoginForm
      rid={rid}
      hasRedirect={!!redirectUri || !!existingRid}
      targetDomain={targetDomain}
      enabledProviders={enabledProviders}
      existingSession={session ? { userId: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null } : null}
    />
  );
}
