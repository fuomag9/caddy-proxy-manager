"use client";

import {
  Alert,
  Box,
  Checkbox,
  Collapse,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import LockPersonIcon from "@mui/icons-material/LockPerson";
import { useState } from "react";
import type { CaCertificate } from "@/src/lib/models/ca-certificates";
import type { MtlsConfig } from "@/src/lib/models/proxy-hosts";

type Props = {
  value?: MtlsConfig | null;
  caCertificates: CaCertificate[];
};

export function MtlsFields({ value, caCertificates }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [selectedIds, setSelectedIds] = useState<number[]>(value?.ca_certificate_ids ?? []);

  function toggleId(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "info.main",
        bgcolor: (theme) =>
          theme.palette.mode === "dark" ? "rgba(2,136,209,0.06)" : "rgba(2,136,209,0.04)",
        p: 2,
      }}
    >
      <input type="hidden" name="mtls_present" value="1" />
      <input type="hidden" name="mtls_enabled" value={enabled ? "true" : "false"} />
      {enabled && selectedIds.map(id => (
        <input key={id} type="hidden" name="mtls_ca_cert_id" value={String(id)} />
      ))}

      {/* Header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5} flex={1} minWidth={0}>
          <Box
            sx={{
              mt: 0.25,
              width: 32,
              height: 32,
              borderRadius: 1.5,
              bgcolor: "info.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <LockPersonIcon sx={{ fontSize: 18, color: "#fff" }} />
          </Box>
          <Box minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700} lineHeight={1.3}>
              Mutual TLS (mTLS)
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.25}>
              Require clients to present a certificate signed by a trusted CA
            </Typography>
          </Box>
        </Stack>
        <Switch
          checked={enabled}
          onChange={(_, checked) => setEnabled(checked)}
          sx={{ flexShrink: 0 }}
        />
      </Stack>

      <Collapse in={enabled} timeout="auto" unmountOnExit>
        <Box mt={2}>
          <Alert severity="info" sx={{ mb: 2 }}>
            mTLS requires TLS to be configured on this host (certificate must be set).
          </Alert>

          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={600}
            sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            Trusted Client CA Certificates
          </Typography>

          {caCertificates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" mt={1}>
              No CA certificates configured. Add them on the Certificates page.
            </Typography>
          ) : (
            <Stack mt={0.5}>
              {caCertificates.map(ca => (
                <FormControlLabel
                  key={ca.id}
                  control={
                    <Checkbox
                      checked={selectedIds.includes(ca.id)}
                      onChange={() => toggleId(ca.id)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">{ca.name}</Typography>
                  }
                />
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
