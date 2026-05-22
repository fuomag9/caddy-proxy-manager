import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { genericOAuthClient, usernameClient } from "better-auth/client/plugins";

// Cast via unknown because better-auth's usernameClient $InferServerPlugin requires
// `email: string` while BetterAuthClientPlugin expects `email?: any` — the version
// resolution differs across environments (local vs. Docker), so the cast keeps both happy.
const usernamePlugin = usernameClient() as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  plugins: [usernamePlugin, genericOAuthClient()],
});
