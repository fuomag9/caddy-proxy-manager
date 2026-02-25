"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { signIn } from "next-auth/react";

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
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLinkAccount = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Call API to verify password and link account
      const response = await fetch("/api/auth/link-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkingId,
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to link account");
        setLoading(false);
        return;
      }

      // Successfully linked - sign in with OAuth
      // The provider should now recognize the linked account
      await signIn(provider, {
        callbackUrl: "/"
      });
    } catch (err) {
      setError("An error occurred while linking your account");
      setLoading(false);
    }
  };

  const handleUsePassword = () => {
    router.push("/login");
  };

  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default"
      }}
    >
      <Card sx={{ maxWidth: 500, width: "100%", p: 1.5 }} elevation={6}>
        <CardContent>
          <Stack spacing={3}>
            <Stack spacing={1} textAlign="center">
              <Typography variant="h5" fontWeight={600}>
                Link Your Account
              </Typography>
              <Typography color="text.secondary">
                An account with <strong>{email}</strong> already exists
              </Typography>
            </Stack>

            <Alert severity="info">
              Would you like to link your <strong>{providerName}</strong> account
              to your existing account? Enter your password to confirm.
            </Alert>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack component="form" onSubmit={handleLinkAccount} spacing={2}>
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                autoComplete="current-password"
                autoFocus
                disabled={loading}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loading}
              >
                {loading ? "Linking Account..." : "Link Account"}
              </Button>

              <Button
                variant="outlined"
                size="large"
                fullWidth
                onClick={handleUsePassword}
                disabled={loading}
              >
                Sign in with Password Instead
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
