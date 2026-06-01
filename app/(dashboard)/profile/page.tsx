import { requireUser } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { listApiTokens } from "@/src/lib/models/api-tokens";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";
import { config } from "@/src/lib/config";

export default async function ProfilePage() {
  const session = await requireUser();
  const userId = Number(session.user.id);

  const user = await getUserById(userId);
  if (!user) {
    redirect(`${config.basePath}/login`);
  }

  const [enabledProviders, apiTokens] = await Promise.all([
    getProviderDisplayList(),
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
