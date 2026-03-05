"use client";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useTransition, useRef, useState } from "react";
import type { CaCertificate } from "@/src/lib/models/ca-certificates";
import {
  createCaCertificateAction,
  deleteCaCertificateAction,
  generateCaCertificateAction,
  issueClientCertificateAction,
  updateCaCertificateAction,
} from "@/app/(dashboard)/certificates/ca-actions";

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CreateCaCertDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"import" | "generate">("generate");
  const [isPending, startTransition] = useTransition();
  const importFormRef = useRef<HTMLFormElement>(null);
  const generateFormRef = useRef<HTMLFormElement>(null);

  function handleClose() {
    setTab("generate");
    onClose();
  }

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(importFormRef.current!);
    startTransition(async () => {
      await createCaCertificateAction(formData);
      handleClose();
    });
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(generateFormRef.current!);
    startTransition(async () => {
      await generateCaCertificateAction(formData);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Client CA Certificate</DialogTitle>
      <DialogContent>
        {true && (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
              <Tab value="generate" label="Generate" />
              <Tab value="import" label="Import PEM" />
            </Tabs>

            {tab === "generate" && (
              <form ref={generateFormRef} onSubmit={handleGenerate}>
                <Stack spacing={2}>
                  <TextField
                    name="name"
                    label="Name"
                    required
                    fullWidth
                    autoFocus
                    placeholder="My Client CA"
                    helperText="Display name in this UI"
                  />
                  <TextField
                    name="common_name"
                    label="Common Name (CN)"
                    fullWidth
                    placeholder="My Client CA"
                    helperText="CN field in the certificate. Defaults to the name above if left blank."
                  />
                  <TextField
                    name="validity_days"
                    label="Validity"
                    type="number"
                    fullWidth
                    defaultValue={3650}
                    inputProps={{ min: 1, max: 3650 }}
                    InputProps={{ endAdornment: <InputAdornment position="end">days</InputAdornment> }}
                  />
                  <DialogActions sx={{ px: 0, pb: 0 }}>
                    <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={isPending}>
                      {isPending ? "Generating..." : "Generate CA Certificate"}
                    </Button>
                  </DialogActions>
                </Stack>
              </form>
            )}

            {tab === "import" && (
              <form ref={importFormRef} onSubmit={handleImport}>
                <Stack spacing={2}>
                  <TextField
                    name="name"
                    label="Name"
                    required
                    fullWidth
                    autoFocus
                    placeholder="My Client CA"
                  />
                  <TextField
                    name="certificate_pem"
                    label="Certificate PEM"
                    required
                    fullWidth
                    multiline
                    minRows={6}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
                    helperText="PEM-encoded X.509 CA certificate (no private key needed)"
                  />
                  <DialogActions sx={{ px: 0, pb: 0 }}>
                    <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={isPending}>
                      {isPending ? "Adding..." : "Add CA Certificate"}
                    </Button>
                  </DialogActions>
                </Stack>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EditCaCertDialog({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CaCertificate;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      await updateCaCertificateAction(cert.id, formData);
      onClose();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit CA Certificate</DialogTitle>
      <form ref={formRef} onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              name="name"
              label="Name"
              required
              fullWidth
              defaultValue={cert.name}
            />
            <TextField
              name="certificate_pem"
              label="Certificate PEM"
              required
              fullWidth
              multiline
              minRows={6}
              defaultValue={cert.certificate_pem}
              inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
              helperText="PEM-encoded X.509 CA certificate"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
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
  const [isPending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ certificatePem: string; privateKeyPem: string; name: string } | null>(null);
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
        setIssued({ ...result, name: String(formData.get("common_name") ?? "client") });
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
              Client certificate issued. Download the certificate and key — the private key will not be stored.
            </Alert>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => downloadText(`${issued.name}.crt`, issued.certificatePem)}
            >
              Download Certificate (.crt)
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => downloadText(`${issued.name}.key`, issued.privateKeyPem)}
            >
              Download Private Key (.key)
            </Button>
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
      try {
        await deleteCaCertificateAction(cert.id);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete");
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

