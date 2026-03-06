"use client";

import {
  Alert,
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
  FormControlLabel,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { CaCertificate } from "@/src/lib/models/ca-certificates";
import type { IssuedClientCertificate } from "@/src/lib/models/issued-client-certificates";
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

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Issue Client Certificate</DialogTitle>
      <DialogContent>
        {issued ? (
          <Stack spacing={2} mt={1}>
            <Alert severity="success">
              Client certificate issued. Download the .p12 bundle now. It contains the client certificate,
              private key, and CA chain, and the private key will not be stored.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Export format: {issued.exportAlgorithm === "3des" ? "Compatibility mode (3DES)" : "AES-256"}.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() =>
                downloadFile(
                  `${issued.name}.p12`,
                  new Blob([decodeBase64(issued.pkcs12Base64)], { type: "application/x-pkcs12" })
                )
              }
            >
              Download Client Certificate (.p12)
            </Button>
            {issued.passwordProtected && (
              <Typography variant="body2" color="text.secondary">
                Import it using the export password you entered during issuance.
              </Typography>
            )}
          </Stack>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit}>
            <Stack spacing={2} mt={1}>
              <TextField
                name="common_name"
                label="Common Name (CN)"
                required
                fullWidth
                autoFocus
                placeholder="alice"
                helperText="Identifies this client (e.g. a username or device name)"
              />
              <TextField
                name="validity_days"
                label="Validity"
                type="number"
                fullWidth
                defaultValue={365}
                inputProps={{ min: 1, max: 3650 }}
                InputProps={{ endAdornment: <InputAdornment position="end">days</InputAdornment> }}
              />
              <TextField
                name="export_password"
                label="Export Password"
                type="password"
                required
                fullWidth
                helperText="Used to protect the .p12 bundle when importing it into operating systems and browsers"
              />
              <FormControlLabel
                control={<Switch name="compatibility_mode" defaultChecked />}
                label="Compatibility mode"
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
                Enabled uses 3DES for broader OS/browser import compatibility. Disabled uses AES-256.
              </Typography>
              {error && <Typography color="error" variant="body2">{error}</Typography>}
              <DialogActions sx={{ px: 0, pb: 0 }}>
                <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                <Button type="submit" variant="contained" disabled={isPending}>
                  {isPending ? "Issuing..." : "Issue Certificate"}
                </Button>
              </DialogActions>
            </Stack>
          </form>
        )}
      </DialogContent>
      {issued && (
        <DialogActions>
          <Button variant="contained" onClick={handleClose}>Done</Button>
        </DialogActions>
      )}
    </Dialog>
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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Issued Client Certificates</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="info">
            Revoking a client certificate removes it from the trusted mTLS client certificate pool for hosts using{" "}
            <strong>{cert.name}</strong>.
          </Alert>
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          {items.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No issued client certificates are currently tracked for this CA. Certificates issued from this UI will
              appear here and can then be revoked individually.
            </Typography>
          ) : (
            items.map((item) => {
              const expired = new Date(item.valid_to).getTime() < Date.now();
              return (
                <Card key={item.id} variant="outlined">
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                        <Box>
                          <Typography variant="h6" fontWeight={600}>
                            {item.common_name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Serial {item.serial_number}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
                          <Chip
                            label={item.revoked_at ? "Revoked" : "Active"}
                            color={item.revoked_at ? "default" : "success"}
                            size="small"
                          />
                          <Chip
                            label={expired ? `Expired ${formatDateTime(item.valid_to)}` : `Expires ${formatDateTime(item.valid_to)}`}
                            color={expired ? "error" : "default"}
                            size="small"
                            variant="outlined"
                          />
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Issued {formatDateTime(item.created_at)}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                      >
                        SHA-256 {formatFingerprint(item.fingerprint_sha256)}
                      </Typography>
                      {item.revoked_at ? (
                        <Typography variant="body2" color="text.secondary">
                          Revoked {formatDateTime(item.revoked_at)}
                        </Typography>
                      ) : (
                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                          <Button
                            variant="outlined"
                            color="error"
                            disabled={isPending}
                            onClick={() => handleRevoke(item.id)}
                          >
                            {isPending ? "Revoking..." : "Revoke"}
                          </Button>
                        </Box>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>Close</Button>
      </DialogActions>
    </Dialog>
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delete CA Certificate</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Delete CA certificate <strong>{cert.name}</strong>? This cannot be undone.
          Proxy hosts using this CA for mTLS will stop requiring client certificates.
        </DialogContentText>
        {error && (
          <Box mt={2}>
            <Typography color="error" variant="body2">{error}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={isPending}>
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
