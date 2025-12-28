"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Divider, Stack, TextField, Typography } from "@mui/material";
import { signIn } from "next-auth/react";
import LoginIcon from "@mui/icons-material/Login";

interface LoginClientProps {
  enabledProviders: Array<{id: string; name: string}>;
}

export default function LoginClient({ enabledProviders = [] }: LoginClientProps) {
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!username || !password) {
      setLoginError("Username and password are required.");
      setLoginPending(false);
      return;
    }

    const result = await signIn("credentials", {
      redirect: false,
      callbackUrl: "/",
      username,
      password
    });

    if (!result || result.error || result.ok === false) {
      let message: string | null = null;

      if (result?.status === 429) {
        message = result.error && result.error !== "CredentialsSignin"
          ? result.error
          : "Too many login attempts. Try again in a few minutes.";
      } else if (result?.error && result.error !== "CredentialsSignin") {
        message = result.error;
      }

      setLoginError(message ?? "Invalid username or password.");
      setLoginPending(false);
      return;
    }

    router.replace(result.url ?? "/");
    router.refresh();
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setLoginError(null);
    setOauthPending(providerId);

    try {
      await signIn(providerId, {
        callbackUrl: "/"
      });
    } catch (error) {
      setLoginError(`Failed to sign in with OAuth`);
      setOauthPending(null);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Card sx={{ maxWidth: 440, width: "100%", p: 1.5 }} elevation={6}>
        <CardContent>
          <Stack spacing={3}>
            <Stack spacing={1} textAlign="center">
              <Typography variant="h5" fontWeight={600}>
                Caddy Proxy Manager
              </Typography>
              <Typography color="text.secondary">
                {enabledProviders.length > 0 ? "Sign in to your account" : "Sign in with your credentials"}
              </Typography>
            </Stack>

            {loginError && <Alert severity="error">{loginError}</Alert>}

            {/* OAuth Providers */}
            {enabledProviders.length > 0 && (
              <Stack spacing={2}>
                {enabledProviders.map((provider) => {
                  const isPending = oauthPending === provider.id;
                  return (
                    <Button
                      key={provider.id}
                      variant="outlined"
                      size="large"
                      fullWidth
                      startIcon={<LoginIcon />}
                      onClick={() => handleOAuthSignIn(provider.id)}
                      disabled={!!oauthPending || loginPending}
                    >
                      {isPending ? `Signing in with ${provider.name}...` : `Continue with ${provider.name}`}
                    </Button>
                  );
                })}

                <Divider>
                  <Typography variant="body2" color="text.secondary">
                    Or sign in with credentials
                  </Typography>
                </Divider>
              </Stack>
            )}

            <Stack component="form" onSubmit={handleSignIn} spacing={2}>
              <TextField
                name="username"
                label="Username"
                required
                fullWidth
                autoComplete="username"
                autoFocus={enabledProviders.length === 0}
                disabled={loginPending || !!oauthPending}
              />
              <TextField
                name="password"
                label="Password"
                type="password"
                required
                fullWidth
                autoComplete="current-password"
                disabled={loginPending || !!oauthPending}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loginPending || !!oauthPending}
              >
                {loginPending ? "Signing in…" : "Sign in"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
