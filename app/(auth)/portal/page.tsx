import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import {
  isForwardAuthDomain,
  createRedirectIntent,
  getDisallowedForwardAuthPort,
} from "@/src/lib/models/forward-auth";
import PortalLoginForm from "./PortalLoginForm";

interface PortalPageProps {
  searchParams: Promise<{ rd?: string | string[]; rid?: string | string[] }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  // A repeated parameter arrives as an array.  CPM never produces one, so it
  // is rejected rather than resolved by picking one of the values.
  const repeatedParam = Array.isArray(params.rd) || Array.isArray(params.rid);
  const redirectUri = typeof params.rd === "string" ? params.rd : "";
  // After OAuth callback, the portal is loaded with ?rid= (the opaque ID we created earlier)
  const existingRid = typeof params.rid === "string" ? params.rid : "";

  // Two entry modes:
  // 1. Fresh from Caddy redirect: ?rd=<full-url> → validate, store server-side, create rid
  // 2. Returning from OAuth: ?rid=<opaque-id> → reuse the existing rid (redirect already stored)
  // A Caddy redirect always carries ?rd=; when it is present any ?rid= is
  // ignored, so a rid smuggled through the protected URL's own query string
  // cannot replace the target the browser was actually sent from.
  let targetDomain = "";
  let errorMessage: string | null = null;
  let rid = redirectUri || repeatedParam ? "" : existingRid;
  if (repeatedParam) {
    errorMessage = "This sign-in link is invalid. Open the site you were trying to reach again.";
  } else if (!rid && redirectUri) {
    try {
      const parsed = new URL(redirectUri);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        await isForwardAuthDomain(parsed.hostname)
      ) {
        targetDomain = parsed.hostname;
        const disallowedPort = await getDisallowedForwardAuthPort(redirectUri);
        if (disallowedPort) {
          errorMessage =
            `This site is served on port ${disallowedPort}, which is not allowed for forward ` +
            "authentication. Ask the administrator to add it to FORWARD_AUTH_ALLOWED_PORTS.";
        } else {
          // Store the redirect URI server-side. The client only gets an opaque ID,
          // so a tampered ?rd= parameter cannot influence the final redirect target.
          rid = await createRedirectIntent(redirectUri);
        }
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
      hasRedirect={!!redirectUri || !!existingRid || repeatedParam}
      targetDomain={targetDomain}
      errorMessage={errorMessage}
      enabledProviders={enabledProviders}
      existingSession={session ? { userId: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null } : null}
    />
  );
}
