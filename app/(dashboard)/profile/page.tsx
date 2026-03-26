import { requireUser } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import { listApiTokens } from "@/src/lib/models/api-tokens";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await requireUser();
  const userId = Number(session.user.id);

  const user = await getUserById(userId);
  if (!user) {
    redirect("/login");
  }

  const [enabledProviders, apiTokens] = await Promise.all([
    Promise.resolve(getEnabledOAuthProviders()),
    listApiTokens(userId),
  ]);

  return (
    <ProfileClient
      user={user}
      enabledProviders={enabledProviders}
      apiTokens={apiTokens}
    />
  );
}
