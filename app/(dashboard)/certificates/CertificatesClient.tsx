"use client";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoIcon from "@mui/icons-material/Info";
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
  Stack,
  TextField,
  Typography
} from "@mui/material";
import type { Certificate } from "@/src/lib/models/certificates";
import { createCertificateAction, deleteCertificateAction, updateCertificateAction } from "./actions";

type Props = {
  certificates: Certificate[];
};

export default function CertificatesClient({ certificates }: Props) {
  const importedCerts = certificates.filter(c => c.type === "imported");
  const managedCerts = certificates.filter(c => c.type === "managed");

  return (
    <Stack spacing={4} sx={{ width: "100%" }}>
      <Stack spacing={1}>
        <Typography variant="h4" fontWeight={600}>
          SSL/TLS Certificates
        </Typography>
        <Typography color="text.secondary">
          Caddy automatically handles HTTPS certificates for all proxy hosts using Let's Encrypt.
          Import custom certificates only when needed (internal CA, special requirements, etc.).
        </Typography>
      </Stack>

      <Alert severity="info" icon={<InfoIcon />}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          How Caddy handles certificates:
        </Typography>
        <Typography variant="body2" component="div">
          • <strong>Automatic HTTPS:</strong> Caddy automatically obtains and renews certificates for all domains
          <br />
          • <strong>No configuration needed:</strong> Just add a proxy host with a domain, and Caddy handles the rest
          <br />
          • <strong>Custom certificates:</strong> Import your own certificates only when you have specific requirements
        </Typography>
      </Alert>

      {managedCerts.length > 0 && (
        <Stack spacing={2}>
          <Alert severity="warning">
            <Typography variant="body2">
              <strong>Legacy "Managed" certificates detected:</strong> These entries are redundant since Caddy automatically manages HTTPS.
              Consider deleting them unless you need to explicitly track certificate usage.
            </Typography>
          </Alert>

          <Typography variant="h6" fontWeight={600}>
            Managed Certificates (Legacy)
          </Typography>

          <Stack spacing={2}>
            {managedCerts.map((cert) => (
              <Card key={cert.id} sx={{ bgcolor: 'action.hover' }}>
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

                  <Accordion elevation={0} disableGutters sx={{ bgcolor: 'transparent' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                      <Typography fontWeight={600}>Edit / Delete</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0 }}>
                      <Stack component="form" action={(formData) => updateCertificateAction(cert.id, formData)} spacing={2}>
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
      )}

      {importedCerts.length > 0 && (
        <Stack spacing={2}>
          <Typography variant="h6" fontWeight={600}>
            Imported Certificates
          </Typography>

          <Stack spacing={2}>
            {importedCerts.map((cert) => (
              <Card key={cert.id}>
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {cert.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {cert.domain_names.join(", ")}
                      </Typography>
                    </Box>
                    <Chip label="Custom Certificate" color="secondary" />
                  </Box>

                  <Accordion elevation={0} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                      <Typography fontWeight={600}>Edit / Delete</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0 }}>
                      <Stack component="form" action={(formData) => updateCertificateAction(cert.id, formData)} spacing={2}>
                        <TextField name="name" label="Name" defaultValue={cert.name} fullWidth />
                        <TextField
                          name="domain_names"
                          label="Domains (one per line)"
                          defaultValue={cert.domain_names.join("\n")}
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
    </Stack>
  );
}
