import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { isForwardAuthDomain, createRedirectIntent } from "@/src/lib/models/forward-auth";
import PortalLoginForm from "./PortalLoginForm";

interface PortalPageProps {
  searchParams: Promise<{ rd?: string; rid?: string }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  const redirectUri = params.rd ?? "";
  // After OAuth callback, the portal is loaded with ?rid= (the opaque ID we created earlier)
  const existingRid = params.rid ?? "";

  // Two entry modes:
  // 1. Fresh from Caddy redirect: ?rd=<full-url> → validate, store server-side, create rid
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
        // so a tampered ?rd= parameter cannot influence the final redirect target.
        rid = await createRedirectIntent(redirectUri);
      }
    } catch {
      // invalid URL — portal will show a generic message
    }
  }

  const session = await auth();
  const enabledProviders = await getProviderDisplayList();

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
