import { requireUser, getCurrentSessionId } from "@/src/lib/auth";
import { getUserById, listUserOAuthProviders } from "@/src/lib/models/user";
import { getProviderDisplayList } from "@/src/lib/models/oauth-providers";
import { listApiTokens } from "@/src/lib/models/api-tokens";
import { listUserSessions } from "@/src/lib/models/sessions";
import ProfileClient from "./ProfileClient";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await requireUser();
  const userId = Number(session.user.id);

  const user = await getUserById(userId);
  if (!user) {
    redirect("/login");
  }

  // OAuth connection state comes from the authoritative accounts table — the
  // informational users.provider/subject columns are only a projection (#261).
  const linkedProviders = await listUserOAuthProviders(userId);

  const [enabledProviders, apiTokens, userSessions, currentSessionId] = await Promise.all([
    getProviderDisplayList(),
    listApiTokens(userId),
    listUserSessions(userId),
    getCurrentSessionId(),
  ]);

  const sessions = userSessions.map((s) => ({ ...s, current: s.id === currentSessionId }));

  // Only what the page needs crosses into the client bundle — never the hash.
  const userData = {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    subject: user.subject,
    hasPassword: !!user.passwordHash,
    role: user.role,
    avatarUrl: user.avatarUrl,
  };

  return (
    <ProfileClient
      user={userData}
      linkedProviders={linkedProviders}
      enabledProviders={enabledProviders}
      apiTokens={apiTokens}
      sessions={sessions}
    />
  );
}
