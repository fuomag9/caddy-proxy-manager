import { auth } from "@/src/lib/auth";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import PortalLoginForm from "./PortalLoginForm";

interface PortalPageProps {
  searchParams: Promise<{ rd?: string }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const params = await searchParams;
  const redirectUri = params.rd ?? "";

  let targetDomain = "";
  try {
    if (redirectUri) {
      targetDomain = new URL(redirectUri).hostname;
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
