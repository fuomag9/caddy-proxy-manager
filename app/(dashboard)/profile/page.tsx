import { requireUser } from "@/src/lib/auth";
import { getUserById } from "@/src/lib/models/user";
import { getEnabledOAuthProviders } from "@/src/lib/config";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await requireUser();

  const user = await getUserById(Number(session.user.id));
  if (!user) {
    redirect("/login");
  }

  const enabledProviders = getEnabledOAuthProviders();

  return (
    <ProfileClient
      user={user}
      enabledProviders={enabledProviders}
    />
  );
}
