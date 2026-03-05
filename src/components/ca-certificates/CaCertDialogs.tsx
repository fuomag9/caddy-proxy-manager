"use client";

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTransition, useRef, useState } from "react";
import type { CaCertificate } from "@/src/lib/models/ca-certificates";
import {
  createCaCertificateAction,
  deleteCaCertificateAction,
  updateCaCertificateAction,
} from "@/app/(dashboard)/certificates/ca-actions";

export function CreateCaCertDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      await createCaCertificateAction(formData);
      onClose();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Client CA Certificate</DialogTitle>
      <form ref={formRef} onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} mt={1}>
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {isPending ? "Adding..." : "Add CA Certificate"}
          </Button>
        </DialogActions>
      </form>
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

