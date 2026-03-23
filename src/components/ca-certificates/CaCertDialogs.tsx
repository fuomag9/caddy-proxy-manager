"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { AppDialog } from "@/components/ui/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import {
  deleteCaCertificateAction,
  issueClientCertificateAction,
  revokeIssuedClientCertificateAction,
} from "@/app/(dashboard)/certificates/ca-actions";

function downloadFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function sanitizeFilenameSegment(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "client";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatFingerprint(value: string): string {
  return value.match(/.{1,2}/g)?.join(":") ?? value;
}

export function IssueClientCertDialog({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{
    pkcs12Base64: string;
    name: string;
    passwordProtected: boolean;
    exportAlgorithm: "3des" | "aes256";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleClose() {
    setIssued(null);
    setError(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    setError(null);
    startTransition(async () => {
      try {
        const result = await issueClientCertificateAction(cert.id, formData);
        setIssued({
          ...result,
          name: sanitizeFilenameSegment(String(formData.get("common_name") ?? "client")),
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to issue certificate");
      }
    });
  }

  const actions = issued ? (
    <Button onClick={handleClose}>Done</Button>
  ) : (
    <>
      <Button variant="outline" onClick={handleClose} disabled={isPending}>
        Cancel
      </Button>
      <Button type="submit" form="issue-cert-form" disabled={isPending}>
        {isPending ? "Issuing..." : "Issue Certificate"}
      </Button>
    </>
  );

  return (
    <AppDialog
      open={open}
      onClose={handleClose}
      title="Issue Client Certificate"
      maxWidth="sm"
      actions={actions}
    >
      {issued ? (
        <div className="flex flex-col gap-4">
          <Alert>
            <AlertDescription>
              Client certificate issued. Download the .p12 bundle now. It contains the client certificate,
              private key, and CA chain, and the private key will not be stored.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Export format: {issued.exportAlgorithm === "3des" ? "Compatibility mode (3DES)" : "AES-256"}.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              downloadFile(
                `${issued.name}.p12`,
                new Blob([decodeBase64(issued.pkcs12Base64)], { type: "application/x-pkcs12" })
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Download Client Certificate (.p12)
          </Button>
          {issued.passwordProtected && (
            <p className="text-sm text-muted-foreground">
              Import it using the export password you entered during issuance.
            </p>
          )}
        </div>
      ) : (
        <form id="issue-cert-form" ref={formRef} onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="common_name">Common Name (CN)</Label>
              <Input
                id="common_name"
                name="common_name"
                required
                autoFocus
                placeholder="alice"
              />
              <p className="text-xs text-muted-foreground">
                Identifies this client (e.g. a username or device name)
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="validity_days">Validity</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="validity_days"
                  name="validity_days"
                  type="number"
                  defaultValue={365}
                  min={1}
                  max={3650}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="export_password">Export Password</Label>
              <Input
                id="export_password"
                name="export_password"
                type="password"
                required
              />
              <p className="text-xs text-muted-foreground">
                Used to protect the .p12 bundle when importing it into operating systems and browsers
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="compatibility_mode" name="compatibility_mode" defaultChecked />
              <Label htmlFor="compatibility_mode">Compatibility mode</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Enabled uses 3DES for broader OS/browser import compatibility. Disabled uses AES-256.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </form>
      )}
    </AppDialog>
  );
}

export function ManageIssuedClientCertsDialog({
  open,
  cert,
  issuedCerts,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  issuedCerts: IssuedClientCertificate[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<IssuedClientCertificate[]>(issuedCerts);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setItems(issuedCerts);
    setError(null);
  }, [issuedCerts, open]);

  function handleRevoke(id: number) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokeIssuedClientCertificateAction(id);
        setItems((current) =>
          current.map((item) =>
            item.id === id ? { ...item, revoked_at: result.revokedAt, updated_at: result.revokedAt } : item
          )
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to revoke certificate");
      }
    });
  }

  const visibleItems = showRevoked ? items : items.filter((i) => !i.revoked_at);
  const revokedCount = items.filter((i) => i.revoked_at).length;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Issued Client Certificates"
      maxWidth="md"
      actions={
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertDescription>
            Revoking a client certificate removes it from the trusted mTLS client certificate pool for hosts using{" "}
            <strong>{cert.name}</strong>.
          </AlertDescription>
        </Alert>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {revokedCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch
              id="show-revoked"
              checked={showRevoked}
              onCheckedChange={setShowRevoked}
            />
            <Label htmlFor="show-revoked">Show revoked ({revokedCount})</Label>
          </div>
        )}
        {visibleItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {items.length === 0
              ? "No issued client certificates are currently tracked for this CA. Certificates issued from this UI will appear here and can then be revoked individually."
              : "No active client certificates. Enable \"Show revoked\" to view revoked certificates."}
          </p>
        ) : (
          visibleItems.map((item) => {
            const expired = new Date(item.valid_to).getTime() < Date.now();
            return (
              <div key={item.id} className="rounded-lg border p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-base">{item.common_name}</p>
                    <p className="text-sm text-muted-foreground">Serial {item.serial_number}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    <Badge variant={item.revoked_at ? "secondary" : "default"}>
                      {item.revoked_at ? "Revoked" : "Active"}
                    </Badge>
                    <Badge variant={expired ? "destructive" : "outline"}>
                      {expired
                        ? `Expired ${formatDateTime(item.valid_to)}`
                        : `Expires ${formatDateTime(item.valid_to)}`}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Issued {formatDateTime(item.created_at)}</p>
                <p className="text-sm text-muted-foreground font-mono break-all">
                  SHA-256 {formatFingerprint(item.fingerprint_sha256)}
                </p>
                {item.revoked_at ? (
                  <p className="text-sm text-muted-foreground">Revoked {formatDateTime(item.revoked_at)}</p>
                ) : (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/10"
                      disabled={isPending}
                      onClick={() => handleRevoke(item.id)}
                    >
                      {isPending ? "Revoking..." : "Revoke"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </AppDialog>
  );
}

export function DeleteCaCertDialog({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCaCertificateAction(cert.id);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "Failed to delete");
      }
    });
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete CA Certificate"
      maxWidth="sm"
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Delete CA certificate <strong className="text-foreground">{cert.name}</strong>? This cannot be undone.
          Proxy hosts using this CA for mTLS will stop requiring client certificates.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppDialog>
  );
}
