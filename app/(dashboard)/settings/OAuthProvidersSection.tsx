"use client";

import { useState, useCallback } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OAuthProvider } from "@/src/lib/models/oauth-providers";
import {
  createOAuthProviderAction,
  updateOAuthProviderAction,
  deleteOAuthProviderAction,
} from "./actions";

interface OAuthProvidersSectionProps {
  initialProviders: OAuthProvider[];
  baseUrl: string;
}

type FormData = {
  name: string;
  type: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  autoLink: boolean;
};

const emptyForm: FormData = {
  name: "",
  type: "oidc",
  clientId: "",
  clientSecret: "",
  issuer: "",
  authorizationUrl: "",
  tokenUrl: "",
  userinfoUrl: "",
  scopes: "openid email profile",
  autoLink: false,
};

export default function OAuthProvidersSection({ initialProviders, baseUrl }: OAuthProvidersSectionProps) {
  const [providers, setProviders] = useState(initialProviders);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const callbackUrl = useCallback(
    (providerId: string) => `${baseUrl}/api/auth/oauth2/callback/${providerId}`,
    [baseUrl]
  );

  function openAddDialog() {
    setEditingProvider(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(provider: OAuthProvider) {
    setEditingProvider(provider);
    setForm({
      name: provider.name,
      type: provider.type,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      issuer: provider.issuer ?? "",
      authorizationUrl: provider.authorizationUrl ?? "",
      tokenUrl: provider.tokenUrl ?? "",
      userinfoUrl: provider.userinfoUrl ?? "",
      scopes: provider.scopes,
      autoLink: provider.autoLink,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.clientId.trim() || !form.clientSecret.trim()) {
      setError("Name, Client ID, and Client Secret are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingProvider) {
        const updated = await updateOAuthProviderAction(editingProvider.id, {
          name: form.name.trim(),
          type: form.type,
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          issuer: form.issuer.trim() || null,
          authorizationUrl: form.authorizationUrl.trim() || null,
          tokenUrl: form.tokenUrl.trim() || null,
          userinfoUrl: form.userinfoUrl.trim() || null,
          scopes: form.scopes.trim() || "openid email profile",
          autoLink: form.autoLink,
        });
        if (updated) {
          setProviders((prev) =>
            prev.map((p) => (p.id === editingProvider.id ? updated : p))
          );
        }
      } else {
        const created = await createOAuthProviderAction({
          name: form.name.trim(),
          type: form.type,
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          issuer: form.issuer.trim() || undefined,
          authorizationUrl: form.authorizationUrl.trim() || undefined,
          tokenUrl: form.tokenUrl.trim() || undefined,
          userinfoUrl: form.userinfoUrl.trim() || undefined,
          scopes: form.scopes.trim() || undefined,
          autoLink: form.autoLink,
        });
        setProviders((prev) => [...prev, created]);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(provider: OAuthProvider) {
    try {
      const updated = await updateOAuthProviderAction(provider.id, {
        enabled: !provider.enabled,
      });
      if (updated) {
        setProviders((prev) =>
          prev.map((p) => (p.id === provider.id ? updated : p))
        );
      }
    } catch (err) {
      console.error("Failed to toggle provider:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteOAuthProviderAction(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete provider:", err);
    }
  }

  function copyToClipboard(text: string, providerId: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(providerId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.length === 0 && (
        <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400 [&>svg]:text-blue-500">
          <AlertDescription>
            No OAuth providers configured. Add a provider to enable single sign-on.
          </AlertDescription>
        </Alert>
      )}

      {providers.map((provider) => (
        <div
          key={provider.id}
          className="flex flex-col gap-2 rounded-md border px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{provider.name}</p>
              <Badge variant="muted">{provider.type.toUpperCase()}</Badge>
              <Badge variant={provider.source === "env" ? "info" : "secondary"}>
                {provider.source === "env" ? "ENV" : "UI"}
              </Badge>
              {!provider.enabled && (
                <Badge variant="warning">Disabled</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`toggle-${provider.id}`} className="text-xs text-muted-foreground">
                  Enabled
                </Label>
                <Switch
                  id={`toggle-${provider.id}`}
                  checked={provider.enabled}
                  onCheckedChange={() => handleToggleEnabled(provider)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditDialog(provider)}
                disabled={provider.source === "env"}
                title={provider.source === "env" ? "Environment-sourced providers cannot be edited" : "Edit provider"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {deleteConfirmId === provider.id ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(provider.id)}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteConfirmId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/50"
                  onClick={() => setDeleteConfirmId(provider.id)}
                  disabled={provider.source === "env"}
                  title={provider.source === "env" ? "Environment-sourced providers cannot be deleted" : "Delete provider"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-muted-foreground break-all">
              {callbackUrl(provider.id)}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => copyToClipboard(callbackUrl(provider.id), provider.id)}
              title="Copy callback URL"
            >
              <Copy className="h-3 w-3" />
            </Button>
            {copiedId === provider.id && (
              <span className="text-xs text-emerald-600">Copied!</span>
            )}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <Button size="sm" onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-1" />
          Add Provider
        </Button>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? "Edit OAuth Provider" : "Add OAuth Provider"}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? "Update the OAuth provider configuration."
                : "Configure a new OAuth or OIDC provider for single sign-on."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-name">Name *</Label>
              <Input
                id="oauth-name"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Google, Keycloak"
                className="h-8 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => updateField("type", v)}
              >
                <SelectTrigger id="oauth-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oidc">OIDC (OpenID Connect)</SelectItem>
                  <SelectItem value="oauth2">OAuth2</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-client-id">Client ID *</Label>
              <Input
                id="oauth-client-id"
                value={form.clientId}
                onChange={(e) => updateField("clientId", e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-client-secret">Client Secret *</Label>
              <Input
                id="oauth-client-secret"
                type="password"
                autoComplete="new-password"
                value={form.clientSecret}
                onChange={(e) => updateField("clientSecret", e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-issuer">Issuer URL</Label>
              <Input
                id="oauth-issuer"
                value={form.issuer}
                onChange={(e) => updateField("issuer", e.target.value)}
                placeholder="https://accounts.google.com"
                className="h-8 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                For OIDC providers, the issuer URL enables automatic discovery of endpoints.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-auth-url">Authorization URL</Label>
              <Input
                id="oauth-auth-url"
                value={form.authorizationUrl}
                onChange={(e) => updateField("authorizationUrl", e.target.value)}
                placeholder="Override discovered endpoint"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-token-url">Token URL</Label>
              <Input
                id="oauth-token-url"
                value={form.tokenUrl}
                onChange={(e) => updateField("tokenUrl", e.target.value)}
                placeholder="Override discovered endpoint"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-userinfo-url">Userinfo URL</Label>
              <Input
                id="oauth-userinfo-url"
                value={form.userinfoUrl}
                onChange={(e) => updateField("userinfoUrl", e.target.value)}
                placeholder="Override discovered endpoint"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-scopes">Scopes</Label>
              <Input
                id="oauth-scopes"
                value={form.scopes}
                onChange={(e) => updateField("scopes", e.target.value)}
                placeholder="openid email profile"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Switch
                id="oauth-auto-link"
                checked={form.autoLink}
                onCheckedChange={(v) => updateField("autoLink", v)}
              />
              <Label htmlFor="oauth-auto-link">
                Auto-link accounts
              </Label>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Automatically link OAuth accounts to existing users with the same email address.
            </p>

            {editingProvider && (
              <div className="flex flex-col gap-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">Callback URL</Label>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-muted-foreground break-all">
                    {callbackUrl(editingProvider.id)}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => copyToClipboard(callbackUrl(editingProvider.id), editingProvider.id)}
                    title="Copy callback URL"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingProvider ? "Update Provider" : "Create Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
