"use client";

import {
  Box,
  Button,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useRef, useState, useTransition } from "react";
import {
  createCaCertificateAction,
  generateCaCertificateAction,
  updateCaCertificateAction,
} from "../ca-actions";
import type { CaCertificateView } from "../page";

type Props = {
  open: boolean;
  cert: CaCertificateView | null;
  onClose: () => void;
};

export function CaCertDrawer({ open, cert, onClose }: Props) {
  const isEdit = cert !== null;
  const [tab, setTab] = useState<"generate" | "import">("generate");
  const [isPending, startTransition] = useTransition();
  const generateRef = useRef<HTMLFormElement>(null);
  const importRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLFormElement>(null);

  function handleClose() {
    setTab("generate");
    onClose();
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(generateRef.current!);
    startTransition(async () => {
      await generateCaCertificateAction(formData);
      handleClose();
    });
  }

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(importRef.current!);
    startTransition(async () => {
      await createCaCertificateAction(formData);
      handleClose();
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(editRef.current!);
    startTransition(async () => {
      await updateCaCertificateAction(cert!.id, formData);
      handleClose();
    });
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, p: 3 } }}
    >
      <Stack spacing={3} height="100%">
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            {isEdit ? "Edit CA Certificate" : "Add CA Certificate"}
          </Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* Content */}
        {isEdit ? (
          /* Edit form */
          <Box
            component="form"
            ref={editRef}
            onSubmit={handleEdit}
            sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
          >
            <TextField
              name="name"
              label="Name"
              required
              fullWidth
              defaultValue={cert.name}
              autoFocus
            />
            <TextField
              name="certificate_pem"
              label="Certificate PEM"
              required
              fullWidth
              multiline
              minRows={8}
              defaultValue={cert.certificate_pem}
              inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
              helperText="PEM-encoded X.509 CA certificate"
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: "auto", pt: 2 }}>
              <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={isPending}>
                {isPending ? "Saving..." : "Save"}
              </Button>
            </Stack>
          </Box>
        ) : (
          /* Add: Generate / Import tabs */
          <Stack spacing={2} sx={{ flex: 1, overflowY: "auto" }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab value="generate" label="Generate" />
              <Tab value="import" label="Import PEM" />
            </Tabs>

            {tab === "generate" && (
              <Box
                component="form"
                ref={generateRef}
                onSubmit={handleGenerate}
                sx={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
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
                <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: "auto", pt: 2 }}>
                  <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                  <Button type="submit" variant="contained" disabled={isPending}>
                    {isPending ? "Generating..." : "Generate CA Certificate"}
                  </Button>
                </Stack>
              </Box>
            )}

            {tab === "import" && (
              <Box
                component="form"
                ref={importRef}
                onSubmit={handleImport}
                sx={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
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
                  minRows={8}
                  placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                  inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
                  helperText="PEM-encoded X.509 CA certificate (no private key needed)"
                />
                <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: "auto", pt: 2 }}>
                  <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                  <Button type="submit" variant="contained" disabled={isPending}>
                    {isPending ? "Adding..." : "Add CA Certificate"}
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}
