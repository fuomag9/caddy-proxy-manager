import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { retrieveLinkingToken, verifyLinkingToken } from "@/src/lib/services/account-linking";
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
    redirect("/");
  }

  // Get linking ID from error parameter (NextAuth redirects with error param)
  const errorParam = searchParams.error || "";

  if (!errorParam.startsWith("LINKING_REQUIRED:")) {
    redirect("/login?error=Invalid linking request");
  }

  const linkingId = errorParam.replace("LINKING_REQUIRED:", "");

  // Retrieve the raw JWT from the server-side store (one-time use)
  const rawToken = await retrieveLinkingToken(linkingId);

  if (!rawToken) {
    redirect("/login?error=Linking token expired or invalid");
  }

  // Verify token and decode
  const tokenPayload = await verifyLinkingToken(rawToken);

  if (!tokenPayload) {
    redirect("/login?error=Linking token expired or invalid");
  }

  return (
    <LinkAccountClient
      provider={tokenPayload.provider}
      email={tokenPayload.email}
      linkingToken={rawToken}
    />
  );
}
