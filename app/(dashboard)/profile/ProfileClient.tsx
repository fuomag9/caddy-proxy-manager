"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/src/lib/auth-client";
import { Camera, Check, Clock, Copy, Key, Link, LogIn, Lock, Plus, Trash2, Unlink, User, AlertTriangle } from "lucide-react";
import type { ApiToken } from "@/lib/models/api-tokens";
import { createApiTokenAction, deleteApiTokenAction } from "../api-tokens/actions";

interface UserData {
  id: number;
  email: string;
  name: string | null;
  provider: string | null;
  subject: string | null;
  passwordHash: string | null;
  role: string;
  avatarUrl: string | null;
}

interface ProfileClientProps {
  user: UserData;
  enabledProviders: Array<{ id: string; name: string }>;
  apiTokens: ApiToken[];
}

export default function ProfileClient({ user, enabledProviders, apiTokens }: ProfileClientProps) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasPassword = !!user.passwordHash;
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
      await authClient.signIn.social({ provider: providerId, callbackURL: "/profile" });
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

  const handleCreateToken = async (formData: FormData) => {
    setError(null);
    setNewToken(null);
    const result = await createApiTokenAction(formData);
    if ("error" in result) {
      setError(result.error);
    } else {
      setNewToken(result.rawToken);
      setSuccess("API token created successfully");
    }
  };

  const handleCopyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const isExpired = (expiresAt: string | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  };

  const getProviderName = (provider: string) => {
    if (provider === "credentials") return "Username/Password";
    if (provider === "oauth2") return "OAuth2";
    if (provider === "authentik") return "Authentik";
    return provider;
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Profile & Account Settings</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex justify-between items-center">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-auto p-0 text-xs">Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="flex justify-between items-center">
            {success}
            <Button variant="ghost" size="sm" onClick={() => setSuccess(null)} className="h-auto p-0 text-xs">Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        {/* Account Information */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Account Information</h2>
            </div>

            <Separator />

            {/* Avatar Section */}
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Profile Picture</p>
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={avatarUrl || undefined} alt={user.name || user.email} />
                  <AvatarFallback className="text-2xl">
                    {(!avatarUrl && user.name) ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex gap-2">
                  <Button variant="outline" asChild disabled={loading}>
                    <label className="cursor-pointer">
                      <Camera className="h-4 w-4 mr-2" />
                      Upload
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                      />
                    </label>
                  </Button>
                  {avatarUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={handleAvatarDelete}
                      disabled={loading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Recommended: Square image, max 2MB</p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="text-sm">{user.email}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="text-sm">{user.name || "Not set"}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <Badge>{user.role}</Badge>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Authentication Method</p>
              <Badge variant={user.provider === "credentials" ? "secondary" : "default"}>
                {getProviderName(user.provider ?? "")}
              </Badge>
            </div>

            {hasPassword && (
              <div>
                <p className="text-sm text-muted-foreground">Password</p>
                <p className="text-sm text-green-600 dark:text-green-400">&#10003; Password is set</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Password Management */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Password Management</h2>
            </div>

            <Separator />

            {hasPassword ? (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Change your password to maintain account security</p>
                <Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>
                  Change Password
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Alert className="border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                  <AlertDescription>
                    You are using OAuth-only authentication. Setting a password will allow you to
                    sign in with either OAuth or credentials.
                  </AlertDescription>
                </Alert>
                <Button onClick={() => setPasswordDialogOpen(true)}>
                  Set Password
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* OAuth Management */}
        {enabledProviders.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-center gap-2">
                <Link className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">OAuth Connections</h2>
              </div>

              <Separator />

              {hasOAuth ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Your account is linked to {getProviderName(user.provider ?? "")}
                  </p>

                  {hasPassword ? (
                    <Button
                      variant="outline"
                      className="text-yellow-600 border-yellow-600/50"
                      onClick={() => setUnlinkDialogOpen(true)}
                    >
                      <Unlink className="h-4 w-4 mr-2" />
                      Unlink OAuth Account
                    </Button>
                  ) : (
                    <Alert className="border-blue-500/50 text-blue-700 dark:text-blue-400">
                      <AlertDescription>
                        To unlink OAuth, you must first set a password as a fallback authentication method.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Link an OAuth provider to enable single sign-on
                  </p>

                  <div className="flex flex-col gap-2">
                    {enabledProviders.map((provider) => (
                      <Button
                        key={provider.id}
                        variant="outline"
                        onClick={() => handleLinkOAuth(provider.id)}
                        className="w-full"
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Link {provider.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* API Tokens */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">API Tokens</h2>
            </div>

            <Separator />

            <p className="text-sm text-muted-foreground">
              Create tokens for programmatic access to the API using <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer {'<token>'}</code>
            </p>

            {/* Newly created token */}
            {newToken && (
              <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/5 p-4 flex flex-col gap-2">
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  Copy this token now — it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono break-all select-all">
                    {newToken}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0 h-8 gap-1.5" onClick={handleCopyToken}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing tokens */}
            {apiTokens.length > 0 && (
              <div className="flex flex-col divide-y divide-border rounded-md border overflow-hidden">
                {apiTokens.map((token) => {
                  const expired = isExpired(token.expiresAt);
                  return (
                    <div
                      key={token.id}
                      className={`flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors ${expired ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{token.name}</p>
                            {expired && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Expired
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0">
                            <p className="text-xs text-muted-foreground">
                              Created {formatDate(token.createdAt)}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Used {formatDate(token.lastUsedAt)}
                            </p>
                            {token.expiresAt && (
                              <p className="text-xs text-muted-foreground">
                                {expired ? "Expired" : "Expires"} {formatDate(token.expiresAt)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <form action={deleteApiTokenAction.bind(null, token.id)}>
                        <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}

            {apiTokens.length === 0 && !newToken && (
              <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                <Key className="h-4 w-4 shrink-0" />
                No API tokens yet — create one below.
              </div>
            )}

            {/* Create new token */}
            <form action={handleCreateToken} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="token-name" className="text-xs">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="token-name" name="name" required placeholder="e.g. CI/CD Pipeline" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="token-expires" className="text-xs">Expires at</Label>
                  <Input id="token-expires" name="expires_at" type="datetime-local" className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Create Token
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{hasPassword ? "Change Password" : "Set Password"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            {hasPassword && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">Minimum 12 characters</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>Cancel</Button>
            <Button onClick={handlePasswordChange} disabled={loading}>
              {loading ? "Saving..." : hasPassword ? "Change Password" : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink OAuth Dialog */}
      <Dialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unlink OAuth Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink your {getProviderName(user.provider ?? "")} account?
              You will only be able to sign in with your username and password after this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleUnlinkOAuth}
              className="text-yellow-600 border-yellow-600/50"
              variant="outline"
              disabled={loading}
            >
              {loading ? "Unlinking..." : "Unlink OAuth"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
