import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient(), genericOAuthClient()],
});
