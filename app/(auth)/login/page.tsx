import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  const enabledProviders = getEnabledOAuthProviders();

  return <LoginClient enabledProviders={enabledProviders} />;
}
