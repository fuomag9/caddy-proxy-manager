import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { config } from "@/src/lib/config";
import { peekLinkingToken, verifyLinkingToken } from "@/src/lib/services/account-linking";
import LinkAccountClient from "./LinkAccountClient";

interface LinkAccountPageProps {
  searchParams: {
    error?: string;
  };
}

export default async function LinkAccountPage({ searchParams }: LinkAccountPageProps) {
  const session = await auth();

  // Already authenticated - redirect
  if (session) {
    redirect(`${config.basePath}/`);
  }

  // Get linking ID from error parameter (NextAuth redirects with error param)
  const errorParam = searchParams.error || "";

  if (!errorParam.startsWith("LINKING_REQUIRED:")) {
    redirect(`${config.basePath}/login?error=Invalid linking request`);
  }

  const linkingId = errorParam.replace("LINKING_REQUIRED:", "");

  // Peek at the raw JWT to decode display info (provider, email) without consuming it.
  // The API endpoint will consume (retrieve + delete) the token during password verification.
  const rawToken = await peekLinkingToken(linkingId);

  if (!rawToken) {
    redirect(`${config.basePath}/login?error=Linking token expired or invalid`);
  }

  // Verify token and decode for display purposes only
  const tokenPayload = await verifyLinkingToken(rawToken);

  if (!tokenPayload) {
    redirect(`${config.basePath}/login?error=Linking token expired or invalid`);
  }

  // Pass only the opaque linkingId to the client — the raw JWT never leaves the server
  return (
    <LinkAccountClient
      provider={tokenPayload.provider}
      email={tokenPayload.email}
      linkingId={linkingId}
    />
  );
}
