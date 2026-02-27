"use client";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DataTable } from "@/src/components/ui/DataTable";
import {
  createCertificateAction,
  deleteCertificateAction,
  updateCertificateAction,
} from "./actions";
import type { AcmeHost, CertExpiryStatus, ImportedCertView, ManagedCertView } from "./page";

type Props = {
  acmeHosts: AcmeHost[];
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  acmePagination: { total: number; page: number; perPage: number };
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function ExpiryChip({
  validTo,
  status,
}: {
  validTo: string | null;
  status: CertExpiryStatus | null;
}) {
  if (status === null || validTo === null) {
    return <Chip label="No PEM" size="small" />;
  }
  if (status === "expired") {
    return <Chip label={`Expired ${formatDate(validTo)}`} color="error" size="small" />;
  }
  if (status === "expiring_soon") {
    return <Chip label={`Expires ${formatDate(validTo)}`} color="warning" size="small" />;
  }
  return <Chip label={`Expires ${formatDate(validTo)}`} color="success" size="small" />;
}

export default function CertificatesClient({ acmeHosts, importedCerts, managedCerts, acmePagination }: Props) {
  const acmeColumns = [
    {
      id: 'name',
      label: 'Proxy Host',
      render: (r: AcmeHost) => <Typography fontWeight={600}>{r.name}</Typography>,
    },
    {
      id: 'domains',
      label: 'Domains',
      render: (r: AcmeHost) => (
        <Typography variant="body2" color="text.secondary">
          {r.domains.join(', ')}
        </Typography>
      ),
    },
    {
      id: 'issuer',
      label: 'Issuer',
      render: (r: AcmeHost) => (
        <Typography variant="body2" color="text.secondary">
          {r.certIssuer ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'expiry',
      label: 'Expiry',
      render: (r: AcmeHost) => <ExpiryChip validTo={r.certValidTo} status={r.certExpiryStatus} />,
    },
    {
      id: 'status',
      label: 'Status',
      render: (r: AcmeHost) => (
        <Chip
          label={r.enabled ? 'Active' : 'Disabled'}
          color={r.enabled ? 'success' : 'default'}
          size="small"
        />
      ),
    },
  ];

  return (
    <Stack spacing={4} sx={{ width: "100%" }}>
      {/* Page header */}
      <Stack spacing={1}>
        <Typography variant="h4" fontWeight={600}>
          SSL/TLS Certificates
        </Typography>
        <Typography color="text.secondary">
          Caddy automatically handles HTTPS certificates for all proxy hosts using Let&apos;s Encrypt.
          Import custom certificates only when needed (internal CA, special requirements, etc.).
        </Typography>
      </Stack>

      {/* ACME Certificates */}
      <Stack spacing={2}>
        <Typography variant="h6" fontWeight={600}>
          ACME Certificates
        </Typography>
        <Typography variant="body2" color="text.secondary">
          These proxy hosts use Caddy&apos;s automatic ACME certificate management (Let&apos;s Encrypt / ZeroSSL).
          No manual configuration required.
        </Typography>
        <DataTable
          columns={acmeColumns}
          data={acmeHosts}
          keyField="id"
          emptyMessage="No proxy hosts using automatic ACME certificates"
          pagination={acmePagination}
        />
      </Stack>

      <Divider />

      {/* Imported Certificates */}
      {importedCerts.length > 0 && (
        <Stack spacing={2}>
          <Typography variant="h6" fontWeight={600}>
            Imported Certificates
          </Typography>

          <Stack spacing={2}>
            {importedCerts.map((cert) => (
              <Card
                key={cert.id}
                elevation={0}
                sx={{ border: "1px solid rgba(148, 163, 184, 0.14)" }}
              >
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {/* Header row */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 2,
                    }}
                  >
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {cert.name}
                      </Typography>
                      {cert.issuer && (
                        <Typography variant="body2" color="text.secondary">
                          {cert.issuer}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <ExpiryChip validTo={cert.validTo} status={cert.expiryStatus} />
                      <Chip label="Custom" color="secondary" size="small" />
                    </Stack>
                  </Box>

                  {/* Domains row */}
                  <Typography variant="body2" color="text.secondary">
                    {cert.domains.join(", ")}
                  </Typography>

                  {/* UsedBy row */}
                  {cert.usedBy.length > 0 && (
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                        Used by:
                      </Typography>
                      {cert.usedBy.map((host) => (
                        <Chip key={host.id} label={host.name} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  )}

                  {/* Edit/Delete accordion */}
                  <Accordion elevation={0} disableGutters sx={{ bgcolor: "transparent" }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                      <Typography fontWeight={600}>Edit / Delete</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0 }}>
                      <Stack
                        component="form"
                        action={(formData) => updateCertificateAction(cert.id, formData)}
                        spacing={2}
                      >
                        <TextField name="name" label="Name" defaultValue={cert.name} fullWidth />
                        <TextField
                          name="domain_names"
                          label="Domains (one per line)"
                          defaultValue={cert.domains.join("\n")}
                          multiline
                          minRows={3}
                          fullWidth
                          helperText="Domains covered by this certificate"
                        />
                        <input type="hidden" name="type" value="imported" />

                        <TextField
                          name="certificate_pem"
                          label="Certificate PEM"
                          placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                          multiline
                          minRows={6}
                          fullWidth
                          helperText="Full chain recommended (cert + intermediates)"
                        />
                        <TextField
                          name="private_key_pem"
                          label="Private Key PEM"
                          placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                          multiline
                          minRows={6}
                          fullWidth
                          helperText="Keep this secure! Never share your private key"
                          type="password"
                        />

                        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
                          <Button type="submit" variant="contained">
                            Update Certificate
                          </Button>
                          <Button
                            type="submit"
                            formAction={deleteCertificateAction.bind(null, cert.id)}
                            variant="outlined"
                            color="error"
                          >
                            Delete
                          </Button>
                        </Box>
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Stack>
      )}

      {/* Import Custom Certificate */}
      <Stack spacing={2} component="section">
        <Typography variant="h6" fontWeight={600}>
          Import Custom Certificate
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            <strong>When to import certificates:</strong>
          </Typography>
          <Typography variant="body2" component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
            <li>Using an internal Certificate Authority (CA)</li>
            <li>Wildcard certificates from your DNS provider</li>
            <li>Pre-existing certificates you want to reuse</li>
            <li>Special compliance or security requirements</li>
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Otherwise:</strong> Just create a proxy host with your domain - Caddy will handle everything automatically!
          </Typography>
        </Alert>

        <Card>
          <CardContent>
            <Stack component="form" action={createCertificateAction} spacing={2}>
              <TextField
                name="name"
                label="Certificate Name"
                placeholder="Internal CA Certificate"
                required
                fullWidth
                helperText="Descriptive name to identify this certificate"
              />

              <TextField
                name="domain_names"
                label="Domains (one per line)"
                placeholder="*.example.com&#10;example.com"
                multiline
                minRows={3}
                required
                fullWidth
                helperText="List all domains/subdomains covered by this certificate"
              />

              <input type="hidden" name="type" value="imported" />

              <TextField
                name="certificate_pem"
                label="Certificate PEM"
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                multiline
                minRows={8}
                required
                fullWidth
                helperText="Paste the full certificate chain (certificate + intermediate certificates)"
              />

              <TextField
                name="private_key_pem"
                label="Private Key PEM"
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                multiline
                minRows={8}
                required
                fullWidth
                helperText="Private key for this certificate. Stored securely."
                type="password"
              />

              <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit" variant="contained" size="large">
                  Import Certificate
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      {/* Legacy Managed (conditional, collapsed) */}
      {managedCerts.length > 0 && (
        <Accordion elevation={0} disableGutters sx={{ border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography fontWeight={600}>Legacy Managed Certificates</Typography>
              <Chip label="Legacy" color="warning" size="small" />
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Alert severity="warning">
                <Typography variant="body2">
                  <strong>Legacy &quot;Managed&quot; certificates detected:</strong> These entries are redundant since Caddy automatically manages HTTPS.
                  Consider deleting them unless you need to explicitly track certificate usage.
                </Typography>
              </Alert>

              <Stack spacing={2}>
                {managedCerts.map((cert) => (
                  <Card key={cert.id} sx={{ bgcolor: "action.hover" }}>
                    <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <Box
                        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <Box>
                          <Typography variant="h6" fontWeight={600}>
                            {cert.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {cert.domain_names.join(", ")}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          <Chip label="Managed by Caddy" color="info" size="small" />
                          <Chip label="Auto-Renew" color="success" size="small" variant="outlined" />
                        </Stack>
                      </Box>

                      <Accordion elevation={0} disableGutters sx={{ bgcolor: "transparent" }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                          <Typography fontWeight={600}>Edit / Delete</Typography>
                        </AccordionSummary>
                        <AccordionDetails sx={{ px: 0 }}>
                          <Stack
                            component="form"
                            action={(formData) => updateCertificateAction(cert.id, formData)}
                            spacing={2}
                          >
                            <TextField name="name" label="Name" defaultValue={cert.name} fullWidth />
                            <TextField
                              name="domain_names"
                              label="Domains (one per line)"
                              defaultValue={cert.domain_names.join("\n")}
                              multiline
                              minRows={3}
                              fullWidth
                              helperText="These domains will be automatically managed by Caddy's ACME"
                            />
                            <input type="hidden" name="type" value="managed" />
                            <input type="hidden" name="auto_renew" value="on" />
                            <input type="hidden" name="auto_renew_present" value="1" />

                            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
                              <Button type="submit" variant="contained">
                                Save
                              </Button>
                              <Button
                                type="submit"
                                formAction={deleteCertificateAction.bind(null, cert.id)}
                                variant="outlined"
                                color="error"
                              >
                                Delete
                              </Button>
                            </Box>
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
