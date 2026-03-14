"use client";

import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import type { ChipProps } from "@mui/material";
import { signIn } from "next-auth/react";
import PersonIcon from "@mui/icons-material/Person";
import LockIcon from "@mui/icons-material/Lock";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import LoginIcon from "@mui/icons-material/Login";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import DeleteIcon from "@mui/icons-material/Delete";

interface User {
  id: number;
  email: string;
  name: string | null;
  provider: string;
  subject: string;
  password_hash: string | null;
  role: string;
  avatar_url: string | null;
}

interface ProfileClientProps {
  user: User;
  enabledProviders: Array<{ id: string; name: string }>;
}

export default function ProfileClient({ user, enabledProviders }: ProfileClientProps) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatar_url);

  const hasPassword = !!user.password_hash;
  const hasOAuth = user.provider !== "credentials";

  const handlePasswordChange = async () => {
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 12) {
      setError("Password must be at least 12 characters long");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to change password");
        setLoading(false);
        return;
      }

      setSuccess("Password changed successfully");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setLoading(false);
    } catch {
      setError("An error occurred while changing password");
      setLoading(false);
    }
  };

  const handleUnlinkOAuth = async () => {
    if (!hasPassword) {
      setError("Cannot unlink OAuth: You must set a password first");
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const response = await fetch("/api/user/unlink-oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to unlink OAuth");
        setLoading(false);
        return;
      }

      setSuccess("OAuth account unlinked successfully. Reloading...");
      setUnlinkDialogOpen(false);
      setLoading(false);

      // Reload page to reflect changes
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setError("An error occurred while unlinking OAuth");
      setLoading(false);
    }
  };

  const handleLinkOAuth = async (providerId: string) => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Set a cookie to indicate this is a linking attempt
      const response = await fetch("/api/user/link-oauth-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId })
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to start OAuth linking");
        setLoading(false);
        return;
      }

      // Now initiate OAuth flow
      await signIn(providerId, {
        callbackUrl: "/profile"
      });
    } catch {
      setError("An error occurred while linking OAuth");
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be smaller than 2MB");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;

        const response = await fetch("/api/user/update-avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarUrl: base64 })
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || "Failed to upload avatar");
          setLoading(false);
          return;
        }

        setAvatarUrl(base64);
        setSuccess("Avatar updated successfully. Refreshing...");
        setLoading(false);

        setTimeout(() => window.location.reload(), 1000);
      };

      reader.readAsDataURL(file);
    } catch {
      setError("An error occurred while uploading avatar");
      setLoading(false);
    }
  };

  const handleAvatarDelete = async () => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/user/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to delete avatar");
        setLoading(false);
        return;
      }

      setAvatarUrl(null);
      setSuccess("Avatar removed successfully. Refreshing...");
      setLoading(false);

      setTimeout(() => window.location.reload(), 1000);
    } catch {
      setError("An error occurred while deleting avatar");
      setLoading(false);
    }
  };

  const getProviderName = (provider: string) => {
    if (provider === "credentials") return "Username/Password";
    if (provider === "oauth2") return "OAuth2";
    if (provider === "authentik") return "Authentik";
    return provider;
  };

  const getProviderColor = (provider: string): ChipProps["color"] => {
    if (provider === "credentials") return "default";
    return "primary";
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Profile & Account Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Account Information */}
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <PersonIcon color="primary" />
                <Typography variant="h6">Account Information</Typography>
              </Box>

              <Divider />

              {/* Avatar Section */}
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Profile Picture
                </Typography>
                <Box display="flex" alignItems="center" gap={2}>
                  <Avatar
                    src={avatarUrl || undefined}
                    alt={user.name || user.email}
                    sx={{ width: 80, height: 80 }}
                  >
                    {(!avatarUrl && user.name) ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box display="flex" gap={1}>
                    <Button
                      variant="outlined"
                      component="label"
                      startIcon={<PhotoCamera />}
                      disabled={loading}
                    >
                      Upload
                      <input
                        type="file"
                        hidden
                        accept="image/*"
                        onChange={handleAvatarUpload}
                      />
                    </Button>
                    {avatarUrl && (
                      <IconButton
                        color="error"
                        onClick={handleAvatarDelete}
                        disabled={loading}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Recommended: Square image, max 2MB
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Email
                </Typography>
                <Typography variant="body1">{user.email}</Typography>
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Name
                </Typography>
                <Typography variant="body1">{user.name || "Not set"}</Typography>
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Role
                </Typography>
                <Chip label={user.role} size="small" color="primary" />
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Authentication Method
                </Typography>
                <Chip
                  label={getProviderName(user.provider)}
                  size="small"
                  color={getProviderColor(user.provider)}
                />
              </Box>

              {hasPassword && (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Password
                  </Typography>
                  <Typography variant="body1" color="success.main">
                    ✓ Password is set
                  </Typography>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Password Management */}
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <LockIcon color="primary" />
                <Typography variant="h6">Password Management</Typography>
              </Box>

              <Divider />

              {hasPassword ? (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Change your password to maintain account security
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => setPasswordDialogOpen(true)}
                    sx={{ mt: 1 }}
                  >
                    Change Password
                  </Button>
                </Box>
              ) : (
                <Box>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    You are using OAuth-only authentication. Setting a password will allow you to
                    sign in with either OAuth or credentials.
                  </Alert>
                  <Button
                    variant="contained"
                    onClick={() => setPasswordDialogOpen(true)}
                  >
                    Set Password
                  </Button>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* OAuth Management */}
        {enabledProviders.length > 0 && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Box display="flex" alignItems="center" gap={1}>
                  <LinkIcon color="primary" />
                  <Typography variant="h6">OAuth Connections</Typography>
                </Box>

                <Divider />

                {hasOAuth ? (
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Your account is linked to {getProviderName(user.provider)}
                    </Typography>

                    {hasPassword ? (
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<LinkOffIcon />}
                        onClick={() => setUnlinkDialogOpen(true)}
                        sx={{ mt: 1 }}
                      >
                        Unlink OAuth Account
                      </Button>
                    ) : (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        To unlink OAuth, you must first set a password as a fallback authentication
                        method.
                      </Alert>
                    )}
                  </Box>
                ) : (
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Link an OAuth provider to enable single sign-on
                    </Typography>

                    <Stack spacing={1} sx={{ mt: 2 }}>
                      {enabledProviders.map((provider) => (
                        <Button
                          key={provider.id}
                          variant="outlined"
                          startIcon={<LoginIcon />}
                          onClick={() => handleLinkOAuth(provider.id)}
                          fullWidth
                        >
                          Link {provider.name}
                        </Button>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{hasPassword ? "Change Password" : "Set Password"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {hasPassword && (
              <TextField
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                fullWidth
                autoComplete="current-password"
              />
            )}
            <TextField
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
              helperText="Minimum 12 characters"
            />
            <TextField
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordDialogOpen(false)}>Cancel</Button>
          <Button onClick={handlePasswordChange} variant="contained" disabled={loading}>
            {loading ? "Saving..." : hasPassword ? "Change Password" : "Set Password"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Unlink OAuth Dialog */}
      <Dialog open={unlinkDialogOpen} onClose={() => setUnlinkDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Unlink OAuth Account</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to unlink your {getProviderName(user.provider)} account?
            You will only be able to sign in with your username and password after this.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnlinkDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUnlinkOAuth} variant="contained" color="warning" disabled={loading}>
            {loading ? "Unlinking..." : "Unlink OAuth"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
