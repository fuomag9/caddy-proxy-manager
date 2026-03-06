"use client";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useState } from "react";
import {
  DeleteCaCertDialog,
  IssueClientCertDialog,
  ManageIssuedClientCertsDialog,
} from "@/src/components/ca-certificates/CaCertDialogs";
import type { CaCertificateView } from "../page";
import { CaCertDrawer } from "./CaCertDrawer";

type Props = {
  caCertificates: CaCertificateView[];
  search: string;
  statusFilter: string | null;
};

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function IssuedCertsPanel({ ca }: { ca: CaCertificateView }) {
  const [issueCaOpen, setIssueCaOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <Box sx={{ p: 2, bgcolor: "action.hover" }}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" fontWeight={600}>
            Issued Client Certificates ({ca.issuedCerts.length})
          </Typography>
          <Stack direction="row" spacing={1}>
            {ca.has_private_key && (
              <Button size="small" variant="outlined" onClick={() => setIssueCaOpen(true)}>
                Issue Cert
              </Button>
            )}
            {ca.issuedCerts.length > 0 && (
              <Button size="small" variant="outlined" onClick={() => setManageOpen(true)}>
                Manage
              </Button>
            )}
          </Stack>
        </Stack>

        {ca.issuedCerts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No issued client certificates tracked for this CA.
          </Typography>
        ) : (
          <>
            {ca.issuedCerts.slice(0, 5).map((issued) => {
              const expired = new Date(issued.valid_to).getTime() < Date.now();
              return (
                <Stack
                  key={issued.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    {issued.common_name}
                  </Typography>
                  <Chip
                    label={issued.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}
                    color={issued.revoked_at ? "default" : expired ? "error" : "success"}
                    size="small"
                  />
                </Stack>
              );
            })}
            {ca.issuedCerts.length > 5 && (
              <Typography variant="body2" color="text.secondary">
                +{ca.issuedCerts.length - 5} more — click &quot;Manage&quot; to view all
              </Typography>
            )}
          </>
        )}
      </Stack>

      <ManageIssuedClientCertsDialog
        open={manageOpen}
        cert={ca}
        issuedCerts={ca.issuedCerts}
        onClose={() => setManageOpen(false)}
      />
      <IssueClientCertDialog
        open={issueCaOpen}
        cert={ca}
        onClose={() => setIssueCaOpen(false)}
      />
    </Box>
  );
}

function CaActionsMenu({
  ca,
  onEdit,
  onDelete,
}: {
  ca: CaCertificateView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [issuedOpen, setIssuedOpen] = useState(false);

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {ca.has_private_key && (
          <MenuItem onClick={() => { setAnchor(null); setIssuedOpen(true); }}>
            Issue Client Cert
          </MenuItem>
        )}
        <MenuItem onClick={() => { setAnchor(null); onEdit(); }}>Edit</MenuItem>
        <MenuItem sx={{ color: "error.main" }} onClick={() => { setAnchor(null); onDelete(); }}>
          Delete
        </MenuItem>
      </Menu>
      <IssueClientCertDialog open={issuedOpen} cert={ca} onClose={() => setIssuedOpen(false)} />
    </>
  );
}

export function CaTab({ caCertificates, search, statusFilter }: Props) {
  const [drawerCert, setDrawerCert] = useState<CaCertificateView | null | false>(false);
  const [deleteCert, setDeleteCert] = useState<CaCertificateView | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = caCertificates.filter((ca) => {
    // CA certs have no expiry status so if filtering by expiry, hide them
    if (statusFilter) return false;
    if (search) return ca.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          size="small"
          onClick={() => setDrawerCert(null)}
        >
          Add CA Certificate
        </Button>
      </Box>

      <TableContainer component={Card} variant="outlined" sx={{ overflowX: "auto" }}>
        <Table sx={{ minWidth: 600 }}>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Name</TableCell>
              <TableCell>Private Key</TableCell>
              <TableCell>Issued Certs</TableCell>
              <TableCell>Added</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                  <Typography color="text.secondary">
                    {search || statusFilter ? "No CA certificates match" : "No CA certificates configured."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ca) => {
                const activeCount = ca.issuedCerts.filter((c) => !c.revoked_at).length;
                const expanded = expandedId === ca.id;
                return (
                  <>
                    <TableRow key={ca.id}>
                      <TableCell width={40} sx={{ pr: 0 }}>
                        <IconButton
                          size="small"
                          onClick={() => setExpandedId(expanded ? null : ca.id)}
                        >
                          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={600}>{ca.name}</Typography>
                      </TableCell>
                      <TableCell>
                        {ca.has_private_key ? (
                          <Chip label="Stored" size="small" color="success" variant="outlined" />
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {ca.issuedCerts.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">None</Typography>
                        ) : (
                          <Chip
                            label={`${activeCount}/${ca.issuedCerts.length} active`}
                            size="small"
                            color={activeCount > 0 ? "success" : "default"}
                            variant="outlined"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatRelativeDate(ca.created_at)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <CaActionsMenu
                          ca={ca}
                          onEdit={() => setDrawerCert(ca)}
                          onDelete={() => setDeleteCert(ca)}
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow key={`${ca.id}-expand`}>
                      <TableCell colSpan={6} sx={{ p: 0, border: expanded ? undefined : "none" }}>
                        <Collapse in={expanded} unmountOnExit>
                          <IssuedCertsPanel ca={ca} />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <CaCertDrawer
        open={drawerCert !== false}
        cert={drawerCert || null}
        onClose={() => setDrawerCert(false)}
      />
      {deleteCert && (
        <DeleteCaCertDialog
          open={!!deleteCert}
          cert={deleteCert}
          onClose={() => setDeleteCert(null)}
        />
      )}
    </Stack>
  );
}
