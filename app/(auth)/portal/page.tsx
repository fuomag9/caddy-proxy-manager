import { auth } from "@/src/lib/auth";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import { isForwardAuthDomain } from "@/src/lib/models/forward-auth";
import PortalLoginForm from "./PortalLoginForm";

interface PortalPageProps {
  searchParams: Promise<{ rd?: string }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  const redirectUri = params.rd ?? "";

  // Only display the target domain if it's a genuine forward-auth-protected host.
  // This prevents attackers from using the portal to phish with arbitrary domain names
  // and avoids leaking the list of configured proxies (we only confirm/deny a specific domain).
  let targetDomain = "";
  try {
    if (redirectUri) {
      const hostname = new URL(redirectUri).hostname;
      if (await isForwardAuthDomain(hostname)) {
        targetDomain = hostname;
      }
    }
  } catch {
    // invalid URL — will be caught by the login endpoint
  }

  const session = await auth();
  const enabledProviders = getEnabledOAuthProviders();

  return (
    <PortalLoginForm
      redirectUri={redirectUri}
      targetDomain={targetDomain}
      enabledProviders={enabledProviders}
      existingSession={session ? { userId: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null } : null}
    />
  );
}
