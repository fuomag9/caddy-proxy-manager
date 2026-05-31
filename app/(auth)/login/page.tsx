import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect(".");
  }

  const enabledProviders = await getProviderDisplayList();

  return <LoginClient enabledProviders={enabledProviders} />;
}
