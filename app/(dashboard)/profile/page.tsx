import { requireUser, getCurrentSessionId } from "@/src/lib/auth";
import { getPasswordSignInStatus, getUserById, getUserPasswordHash, listUserOAuthProviders } from "@/src/lib/models/user";
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

  const [enabledProviders, apiTokens, userSessions, currentSessionId, passwordHash, passwordSignIn] = await Promise.all([
    getProviderDisplayList(),
    listApiTokens(userId),
    listUserSessions(userId),
    getCurrentSessionId(),
    getUserPasswordHash(user),
    getPasswordSignInStatus(userId),
  ]);

  const sessions = userSessions.map((s) => ({ ...s, current: s.id === currentSessionId }));

  // Only what the page needs crosses into the client bundle — never the hash.
  const userData = {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    subject: user.subject,
    hasPassword: !!passwordHash,
    // Same check the unlink-oauth route makes, so the unlink button only shows
    // when the login page would still let the user in; otherwise the reason.
    signInUsername: passwordSignIn.username,
    passwordSignInBlocker: passwordSignIn.blocker,
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
