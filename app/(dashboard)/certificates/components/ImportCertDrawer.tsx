"use client";

import {
  Box,
  Button,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useRef, useState, useTransition } from "react";
import { createCertificateAction, updateCertificateAction } from "../actions";
import type { ImportedCertView } from "../page";

type Props = {
  open: boolean;
  cert: ImportedCertView | null;
  onClose: () => void;
};

export function ImportCertDrawer({ open, cert, onClose }: Props) {
  const isEdit = cert !== null;
  const [isPending, startTransition] = useTransition();
  const [showKey, setShowKey] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const certFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setCertPem("");
    setKeyPem("");
    setShowKey(false);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      if (isEdit) {
        await updateCertificateAction(cert.id, formData);
      } else {
        await createCertificateAction(formData);
      }
      handleClose();
    });
  }

  function readFile(file: File, setter: (v: string) => void) {
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target?.result as string);
    reader.readAsText(file);
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
            {isEdit ? "Edit Certificate" : "Import Certificate"}
          </Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* Form */}
        <Box
          component="form"
          ref={formRef}
          onSubmit={handleSubmit}
          sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
        >
          <input type="hidden" name="type" value="imported" />

          <TextField
            name="name"
            label="Name"
            defaultValue={isEdit ? cert.name : ""}
            required
            fullWidth
            autoFocus
            helperText="Descriptive name to identify this certificate"
          />

          <TextField
            name="domain_names"
            label="Domains (one per line)"
            defaultValue={isEdit ? cert.domains.join("\n") : ""}
            multiline
            minRows={3}
            fullWidth
            helperText="Domains covered by this certificate"
          />

          {/* Certificate PEM */}
          <Stack spacing={1}>
            <TextField
              name="certificate_pem"
              label="Certificate PEM"
              placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
              multiline
              minRows={6}
              fullWidth
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              helperText="Full chain recommended (cert + intermediates)"
              inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
            />
            <input
              type="file"
              ref={certFileRef}
              accept=".pem,.crt,.cer,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file, setCertPem);
              }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => certFileRef.current?.click()}
              sx={{ alignSelf: "flex-start" }}
            >
              Load from file
            </Button>
          </Stack>

          {/* Private Key PEM */}
          <Stack spacing={1}>
            <TextField
              name="private_key_pem"
              label="Private Key PEM"
              placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
              multiline={showKey}
              minRows={showKey ? 6 : undefined}
              type={showKey ? "text" : "password"}
              fullWidth
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              helperText="Keep this secure! Never share your private key"
              inputProps={{ style: { fontFamily: "monospace", fontSize: "0.8rem" } }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={showKey ? "Hide" : "Show"}>
                      <IconButton size="small" onClick={() => setShowKey((v) => !v)} edge="end">
                        {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <input
              type="file"
              ref={keyFileRef}
              accept=".pem,.key,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file, setKeyPem);
              }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => keyFileRef.current?.click()}
              sx={{ alignSelf: "flex-start" }}
            >
              Load from file
            </Button>
          </Stack>

          {/* Actions */}
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: "auto", pt: 2 }}>
            <Button onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save Changes" : "Import Certificate"}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  );
}
