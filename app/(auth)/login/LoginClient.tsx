"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/src/lib/auth-client";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

interface LoginClientProps {
  enabledProviders: Array<{ id: string; name: string }>;
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

    const { data, error } = await authClient.signIn.username({
      username,
      password,
    });

    if (error) {
      let message: string | null = null;
      if (error.status === 429) {
        message = error.message || "Too many login attempts. Try again in a few minutes.";
      } else if (error.message) {
        message = error.message;
      }
      setLoginError(message ?? "Invalid username or password.");
      setLoginPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setLoginError(null);
    setOauthPending(providerId);
    try {
      await authClient.signIn.social({ provider: providerId, callbackURL: "/" });
    } catch {
      setLoginError("Failed to sign in with OAuth");
      setOauthPending(null);
    }
  };

  const disabled = loginPending || !!oauthPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold">Caddy Proxy Manager</CardTitle>
          <CardDescription>
            {enabledProviders.length > 0
              ? "Sign in to your account"
              : "Sign in with your credentials"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loginError && (
            <Alert variant="destructive">
              <AlertDescription>{loginError}</AlertDescription>
            </Alert>
          )}

          {enabledProviders.length > 0 && (
            <>
              <div className="space-y-2">
                {enabledProviders.map((provider) => {
                  const isPending = oauthPending === provider.id;
                  return (
                    <Button
                      key={provider.id}
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOAuthSignIn(provider.id)}
                      disabled={disabled}
                    >
                      {isPending ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                      ) : (
                        <LogIn className="h-4 w-4 mr-2" />
                      )}
                      {isPending ? `Signing in with ${provider.name}…` : `Continue with ${provider.name}`}
                    </Button>
                  );
                })}
              </div>
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  Or sign in with credentials
                </span>
              </div>
            </>
          )}

          <form onSubmit={handleSignIn} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                required
                autoComplete="username"
                autoFocus={enabledProviders.length === 0}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                disabled={disabled}
              />
            </div>
            <Button type="submit" className="w-full" disabled={disabled}>
              {loginPending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
