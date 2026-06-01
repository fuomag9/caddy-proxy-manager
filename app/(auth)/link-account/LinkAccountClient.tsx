"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/src/lib/auth-client";
import { useBasePath } from "@/src/hooks/useBasePath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LinkAccountClientProps {
  provider: string;
  email: string;
  linkingId: string;
}

export default function LinkAccountClient({
  provider,
  email,
  linkingId
}: LinkAccountClientProps) {
  const router = useRouter();
  const basePath = useBasePath();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLinkAccount = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/link-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkingId, password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to link account");
        setLoading(false);
        return;
      }

      await authClient.signIn.social({ provider, callbackURL: `${basePath}/` });
    } catch {
      setError("An error occurred while linking your account");
      setLoading(false);
    }
  };

  const handleUsePassword = () => {
    router.push(`${basePath}/login`);
  };

  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold">Link Your Account</CardTitle>
          <CardDescription>
            An account with <strong>{email}</strong> already exists
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Would you like to link your <strong>{providerName}</strong> account to your existing
            account? Enter your password to confirm.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleLinkAccount} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                autoFocus
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  Linking Account…
                </>
              ) : (
                "Link Account"
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleUsePassword}
              disabled={loading}
            >
              Sign in with Password Instead
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
