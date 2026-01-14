"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Tooltip
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import { useFormState } from "react-dom";
import type { AccessList } from "@/src/lib/models/access-lists";
import type { Certificate } from "@/src/lib/models/certificates";
import type { ProxyHost } from "@/src/lib/models/proxy-hosts";
import type { AuthentikSettings } from "@/src/lib/settings";
import { INITIAL_ACTION_STATE, type ActionState } from "@/src/lib/actions";
import { createProxyHostAction, deleteProxyHostAction, updateProxyHostAction, toggleProxyHostAction } from "./actions";

type Props = {
  hosts: ProxyHost[];
  certificates: Certificate[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings | null;
};

const AUTHENTIK_DEFAULT_HEADERS = [
  "X-Authentik-Username",
  "X-Authentik-Groups",
  "X-Authentik-Entitlements",
  "X-Authentik-Email",
  "X-Authentik-Name",
  "X-Authentik-Uid",
  "X-Authentik-Jwt",
  "X-Authentik-Meta-Jwks",
  "X-Authentik-Meta-Outpost",
  "X-Authentik-Meta-Provider",
  "X-Authentik-Meta-App",
  "X-Authentik-Meta-Version"
];

const AUTHENTIK_DEFAULT_TRUSTED_PROXIES = ["private_ranges"];

export default function ProxyHostsClient({ hosts, certificates, accessLists, authentikDefaults }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createDialogKey, setCreateDialogKey] = useState(0);
  const [editHost, setEditHost] = useState<ProxyHost | null>(null);
  const [deleteHost, setDeleteHost] = useState<ProxyHost | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredHosts = useMemo(() => {
    if (!searchTerm.trim()) return hosts;

    const search = searchTerm.toLowerCase();
    return hosts.filter((host) => {
      // Search in name
      if (host.name.toLowerCase().includes(search)) return true;

      // Search in domains
      if (host.domains.some(domain => domain.toLowerCase().includes(search))) return true;

      // Search in upstreams
      if (host.upstreams.some(upstream => upstream.toLowerCase().includes(search))) return true;

      // Search in certificate name
      const certificate = host.certificate_id
        ? certificates.find(c => c.id === host.certificate_id)
        : null;
      const certName = certificate?.name ?? "Managed by Caddy (Auto)";
      if (certName.toLowerCase().includes(search)) return true;

      return false;
    });
  }, [hosts, certificates, searchTerm]);

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    await toggleProxyHostAction(id, enabled);
  };

  const handleOpenCreate = () => {
    setCreateDialogKey(prev => prev + 1);
    setCreateOpen(true);
  };

  return (
    <Stack spacing={4} sx={{ width: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Stack spacing={1}>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "rgba(255, 255, 255, 0.95)"
            }}
          >
            Proxy Hosts
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 600 }}>
            Define HTTP(S) reverse proxies orchestrated by Caddy with automated certificates.
          </Typography>
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleOpenCreate}
          sx={{
            bgcolor: "rgba(99, 102, 241, 0.9)",
            "&:hover": { bgcolor: "rgba(99, 102, 241, 1)" }
          }}
        >
          Create Host
        </Button>
      </Stack>

      <TextField
        placeholder="Search proxy hosts..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        slotProps={{
          input: {
            startAdornment: <SearchIcon sx={{ mr: 1, color: "rgba(255, 255, 255, 0.5)" }} />
          }
        }}
        sx={{
          maxWidth: 500,
          "& .MuiOutlinedInput-root": {
            bgcolor: "rgba(20, 20, 22, 0.6)",
            "&:hover": {
              bgcolor: "rgba(20, 20, 22, 0.8)"
            }
          }
        }}
      />

      <TableContainer
        component={Card}
        sx={{
          background: "rgba(20, 20, 22, 0.6)",
          border: "0.5px solid rgba(255, 255, 255, 0.08)"
        }}
      >
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: "rgba(255, 255, 255, 0.02)" }}>
              <TableCell sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Domains</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Upstreams</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Certificate</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.7)" }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredHosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: "text.secondary" }}>
                  {searchTerm ? "No proxy hosts match your search." : "No proxy hosts configured. Click \"Create Host\" to add one."}
                </TableCell>
              </TableRow>
            ) : (
              filteredHosts.map((host) => {
                const certificate = host.certificate_id
                  ? certificates.find(c => c.id === host.certificate_id)
                  : null;
                const certName = certificate?.name ?? "Managed by Caddy (Auto)";

                return (
                  <TableRow
                    key={host.id}
                    sx={{
                      "&:hover": { bgcolor: "rgba(255, 255, 255, 0.02)" }
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: "rgba(255, 255, 255, 0.9)" }}>
                        {host.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.8125rem" }}>
                        {host.domains.slice(0, 2).join(", ")}
                        {host.domains.length > 2 && ` +${host.domains.length - 2} more`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.8125rem" }}>
                        {host.upstreams.slice(0, 2).join(", ")}
                        {host.upstreams.length > 2 && ` +${host.upstreams.length - 2} more`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.8125rem" }}>
                        {certName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={host.enabled}
                        onChange={(e) => handleToggleEnabled(host.id, e.target.checked)}
                        size="small"
                        sx={{
                          "& .MuiSwitch-switchBase.Mui-checked": {
                            color: "rgba(34, 197, 94, 1)"
                          },
                          "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                            backgroundColor: "rgba(34, 197, 94, 0.5)"
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => setEditHost(host)}
                            sx={{
                              color: "rgba(99, 102, 241, 0.8)",
                              "&:hover": { bgcolor: "rgba(99, 102, 241, 0.1)" }
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => setDeleteHost(host)}
                            sx={{
                              color: "rgba(239, 68, 68, 0.8)",
                              "&:hover": { bgcolor: "rgba(239, 68, 68, 0.1)" }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateHostDialog
        key={createDialogKey}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        certificates={certificates}
        accessLists={accessLists}
        authentikDefaults={authentikDefaults}
      />

      {editHost && (
        <EditHostDialog
          open={!!editHost}
          host={editHost}
          onClose={() => setEditHost(null)}
          certificates={certificates}
          accessLists={accessLists}
        />
      )}

      {deleteHost && (
        <DeleteHostDialog
          open={!!deleteHost}
          host={deleteHost}
          onClose={() => setDeleteHost(null)}
        />
      )}
    </Stack>
  );
}

function CreateHostDialog({
  open,
  onClose,
  certificates,
  accessLists,
  authentikDefaults
}: {
  open: boolean;
  onClose: () => void;
  certificates: Certificate[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings | null;
}) {
  const [state, formAction] = useFormState(createProxyHostAction, INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      // revalidatePath in server action already handles the refresh
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "rgba(20, 20, 22, 0.98)",
          border: "0.5px solid rgba(255, 255, 255, 0.1)",
          backgroundImage: "none"
        }
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Create Proxy Host
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack component="form" id="create-form" action={formAction} spacing={2.5}>
          {state.status !== "idle" && state.message && (
            <Alert severity={state.status === "error" ? "error" : "success"}>
              {state.message}
            </Alert>
          )}
          <SettingsToggles />
          <TextField name="name" label="Name" placeholder="My Service" required fullWidth />
          <TextField
            name="domains"
            label="Domains"
            placeholder="app.example.com"
            helperText="One per line or comma-separated"
            multiline
            minRows={2}
            required
            fullWidth
          />
          <UpstreamInput />
          <TextField select name="certificate_id" label="Certificate" defaultValue="" fullWidth>
            <MenuItem value="">Managed by Caddy (Auto)</MenuItem>
            {certificates.map((cert) => (
              <MenuItem key={cert.id} value={cert.id}>
                {cert.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select name="access_list_id" label="Access List" defaultValue="" fullWidth>
            <MenuItem value="">None</MenuItem>
            {accessLists.map((list) => (
              <MenuItem key={list.id} value={list.id}>
                {list.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            name="custom_pre_handlers_json"
            label="Custom Pre-Handlers (JSON)"
            placeholder='[{"handler": "headers", ...}]'
            helperText="Optional JSON array of Caddy handlers"
            multiline
            minRows={3}
            fullWidth
          />
          <TextField
            name="custom_reverse_proxy_json"
            label="Custom Reverse Proxy (JSON)"
            placeholder='{"headers": {"request": {...}}}'
            helperText="Deep-merge into reverse_proxy handler"
            multiline
            minRows={3}
            fullWidth
          />
          <AuthentikFields defaults={authentikDefaults} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: "rgba(255, 255, 255, 0.6)" }}>
          Cancel
        </Button>
        <Button type="submit" form="create-form" variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditHostDialog({
  open,
  host,
  onClose,
  certificates,
  accessLists
}: {
  open: boolean;
  host: ProxyHost;
  onClose: () => void;
  certificates: Certificate[];
  accessLists: AccessList[];
}) {
  const [state, formAction] = useFormState(updateProxyHostAction.bind(null, host.id), INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      // revalidatePath in server action already handles the refresh
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "rgba(20, 20, 22, 0.98)",
          border: "0.5px solid rgba(255, 255, 255, 0.1)",
          backgroundImage: "none"
        }
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Edit Proxy Host
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack component="form" id="edit-form" action={formAction} spacing={2.5}>
          {state.status !== "idle" && state.message && (
            <Alert severity={state.status === "error" ? "error" : "success"}>
              {state.message}
            </Alert>
          )}
          <SettingsToggles
            hstsSubdomains={host.hsts_subdomains}
            skipHttpsValidation={host.skip_https_hostname_validation}
            enabled={host.enabled}
          />
          <TextField name="name" label="Name" defaultValue={host.name} required fullWidth />
          <TextField
            name="domains"
            label="Domains"
            defaultValue={host.domains.join("\n")}
            helperText="One per line or comma-separated"
            multiline
            minRows={2}
            fullWidth
          />
          <UpstreamInput defaultUpstreams={host.upstreams} />
          <TextField select name="certificate_id" label="Certificate" defaultValue={host.certificate_id ?? ""} fullWidth>
            <MenuItem value="">Managed by Caddy (Auto)</MenuItem>
            {certificates.map((cert) => (
              <MenuItem key={cert.id} value={cert.id}>
                {cert.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select name="access_list_id" label="Access List" defaultValue={host.access_list_id ?? ""} fullWidth>
            <MenuItem value="">None</MenuItem>
            {accessLists.map((list) => (
              <MenuItem key={list.id} value={list.id}>
                {list.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            name="custom_pre_handlers_json"
            label="Custom Pre-Handlers (JSON)"
            defaultValue={host.custom_pre_handlers_json ?? ""}
            helperText="Optional JSON array of Caddy handlers"
            multiline
            minRows={3}
            fullWidth
          />
          <TextField
            name="custom_reverse_proxy_json"
            label="Custom Reverse Proxy (JSON)"
            defaultValue={host.custom_reverse_proxy_json ?? ""}
            helperText="Deep-merge into reverse_proxy handler"
            multiline
            minRows={3}
            fullWidth
          />
          <AuthentikFields authentik={host.authentik} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: "rgba(255, 255, 255, 0.6)" }}>
          Cancel
        </Button>
        <Button type="submit" form="edit-form" variant="contained">
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteHostDialog({
  open,
  host,
  onClose
}: {
  open: boolean;
  host: ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState(deleteProxyHostAction.bind(null, host.id), INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.status === "success") {
      // revalidatePath in server action already handles the refresh
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      PaperProps={{
        sx: {
          bgcolor: "rgba(20, 20, 22, 0.98)",
          border: "0.5px solid rgba(239, 68, 68, 0.3)",
          backgroundImage: "none"
        }
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: "rgba(239, 68, 68, 1)" }}>
          Delete Proxy Host
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {state.status !== "idle" && state.message && (
            <Alert severity={state.status === "error" ? "error" : "success"}>
              {state.message}
            </Alert>
          )}
          <Typography variant="body1">
            Are you sure you want to delete the proxy host <strong>{host.name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This will remove the configuration for:
          </Typography>
          <Box sx={{ pl: 2 }}>
            <Typography variant="body2" color="text.secondary">
              • Domains: {host.domains.join(", ")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • Upstreams: {host.upstreams.join(", ")}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "rgba(239, 68, 68, 0.9)", fontWeight: 500 }}>
            This action cannot be undone.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: "rgba(255, 255, 255, 0.6)" }}>
          Cancel
        </Button>
        <form action={formAction} style={{ display: 'inline' }}>
          <Button
            type="submit"
            variant="contained"
            color="error"
          >
            Delete
          </Button>
        </form>
      </DialogActions>
    </Dialog>
  );
}

function AuthentikFields({
  authentik,
  defaults
}: {
  authentik?: ProxyHost["authentik"] | null;
  defaults?: AuthentikSettings | null;
}) {
  const initial = authentik ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);

  const copyHeadersValue =
    initial && initial.copyHeaders.length > 0 ? initial.copyHeaders.join("\n") : AUTHENTIK_DEFAULT_HEADERS.join("\n");
  const trustedProxiesValue =
    initial && initial.trustedProxies.length > 0
      ? initial.trustedProxies.join("\n")
      : AUTHENTIK_DEFAULT_TRUSTED_PROXIES.join("\n");
  const setHostHeaderDefault = initial?.setOutpostHostHeader ?? true;

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid rgba(99, 102, 241, 0.2)",
        background: "rgba(99, 102, 241, 0.05)",
        p: 2.5
      }}
    >
      <input type="hidden" name="authentik_present" value="1" />
      <input type="hidden" name="authentik_enabled_present" value="1" />
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Authentik Forward Auth
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem" }}>
              Proxy authentication via Authentik outpost
            </Typography>
          </Box>
          <Switch
            name="authentik_enabled"
            checked={enabled}
            onChange={(_, checked) => setEnabled(checked)}
          />
        </Stack>

        <Collapse in={enabled} timeout="auto" unmountOnExit>
          <Stack spacing={2}>
            <TextField
              name="authentik_outpost_domain"
              label="Outpost Domain"
              placeholder="outpost.goauthentik.io"
              defaultValue={initial?.outpostDomain ?? defaults?.outpostDomain ?? ""}
              required={enabled}
              disabled={!enabled}
              size="small"
              fullWidth
            />
            <TextField
              name="authentik_outpost_upstream"
              label="Outpost Upstream URL"
              placeholder="https://outpost.internal:9000"
              defaultValue={initial?.outpostUpstream ?? defaults?.outpostUpstream ?? ""}
              required={enabled}
              disabled={!enabled}
              size="small"
              fullWidth
            />
            <TextField
              name="authentik_auth_endpoint"
              label="Auth Endpoint (Optional)"
              placeholder="/outpost.goauthentik.io/auth/caddy"
              defaultValue={initial?.authEndpoint ?? defaults?.authEndpoint ?? ""}
              disabled={!enabled}
              size="small"
              fullWidth
            />
            <TextField
              name="authentik_copy_headers"
              label="Headers to Copy"
              defaultValue={copyHeadersValue}
              disabled={!enabled}
              multiline
              minRows={3}
              size="small"
              fullWidth
            />
            <TextField
              name="authentik_trusted_proxies"
              label="Trusted Proxies"
              defaultValue={trustedProxiesValue}
              disabled={!enabled}
              size="small"
              fullWidth
            />
            <TextField
              name="authentik_protected_paths"
              label="Protected Paths (Optional)"
              placeholder="/secret/*, /admin/*"
              helperText="Leave empty to protect entire domain. Specify paths to protect specific routes only."
              defaultValue={initial?.protectedPaths?.join(", ") ?? ""}
              disabled={!enabled}
              multiline
              minRows={2}
              size="small"
              fullWidth
            />
            <HiddenCheckboxField
              name="authentik_set_host_header"
              defaultChecked={setHostHeaderDefault}
              label="Set Host Header for Outpost"
              disabled={!enabled}
              helperText="Recommended: Keep enabled. Only disable if using IP-based outpost access or troubleshooting routing issues."
            />
          </Stack>
        </Collapse>
      </Stack>
    </Box>
  );
}

function HiddenCheckboxField({
  name,
  defaultChecked,
  label,
  disabled,
  helperText
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
  disabled?: boolean;
  helperText?: string;
}) {
  return (
    <Box>
      <input type="hidden" name={`${name}_present`} value="1" />
      <FormControlLabel
        control={
          <Checkbox
            name={name}
            defaultChecked={defaultChecked}
            disabled={disabled}
            size="small"
            sx={{
              color: "rgba(148, 163, 184, 0.6)",
              "&.Mui-checked": { color: "#6366f1" }
            }}
          />
        }
        label={<Typography variant="body2">{label}</Typography>}
        disabled={disabled}
      />
      {helperText && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 4, mt: -0.5 }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );
}

type ToggleSetting = {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
  color?: "success" | "warning" | "default";
};

function SettingsToggles({
  hstsSubdomains = false,
  skipHttpsValidation = false,
  enabled = true
}: {
  hstsSubdomains?: boolean;
  skipHttpsValidation?: boolean;
  enabled?: boolean;
}) {
  const [values, setValues] = useState({
    hsts_subdomains: hstsSubdomains,
    skip_https_hostname_validation: skipHttpsValidation,
    enabled: enabled
  });

  const handleChange = (name: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues(prev => ({ ...prev, [name]: event.target.checked }));
  };

  const toggleEnabled = () => {
    setValues(prev => ({ ...prev, enabled: !prev.enabled }));
  };

  const settings: ToggleSetting[] = [
    {
      name: "hsts_subdomains",
      label: "HSTS Subdomains",
      description: "Include subdomains in the Strict-Transport-Security header",
      defaultChecked: values.hsts_subdomains,
      color: "default"
    },
    {
      name: "skip_https_hostname_validation",
      label: "Skip HTTPS Validation",
      description: "Skip SSL certificate hostname verification for backend connections",
      defaultChecked: values.skip_https_hostname_validation,
      color: "warning"
    }
  ];

  return (
    <Stack spacing={2}>
      {/* Prominent Enabled/Paused Control */}
      <input type="hidden" name="enabled_present" value="1" />
      <input type="hidden" name="enabled" value={values.enabled ? "on" : ""} />
      <Box
        onClick={toggleEnabled}
        sx={{
          borderRadius: 2,
          border: values.enabled
            ? "1px solid rgba(34, 197, 94, 0.4)"
            : "1px solid rgba(251, 191, 36, 0.4)",
          background: values.enabled
            ? "rgba(34, 197, 94, 0.08)"
            : "rgba(251, 191, 36, 0.08)",
          p: 2,
          cursor: "pointer",
          transition: "all 0.2s ease",
          "&:hover": {
            background: values.enabled
              ? "rgba(34, 197, 94, 0.12)"
              : "rgba(251, 191, 36, 0.12)",
            borderColor: values.enabled
              ? "rgba(34, 197, 94, 0.6)"
              : "rgba(251, 191, 36, 0.6)"
          }
        }}
      >
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: values.enabled
                ? "rgba(34, 197, 94, 0.2)"
                : "rgba(251, 191, 36, 0.2)",
              color: values.enabled
                ? "rgba(34, 197, 94, 1)"
                : "rgba(251, 191, 36, 1)",
              transition: "all 0.2s ease"
            }}
          >
            {values.enabled ? (
              <PlayArrowRoundedIcon sx={{ fontSize: 28 }} />
            ) : (
              <PauseRoundedIcon sx={{ fontSize: 28 }} />
            )}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                color: values.enabled
                  ? "rgba(34, 197, 94, 1)"
                  : "rgba(251, 191, 36, 1)"
              }}
            >
              {values.enabled ? "Active" : "Paused"}
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.6)" }}>
              {values.enabled
                ? "This proxy host is enabled and routing traffic"
                : "This proxy host is paused and not routing traffic"}
            </Typography>
          </Box>
          <Typography
            variant="caption"
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              bgcolor: "rgba(255, 255, 255, 0.05)",
              color: "rgba(255, 255, 255, 0.5)"
            }}
          >
            Click to {values.enabled ? "pause" : "activate"}
          </Typography>
        </Stack>
      </Box>

      {/* Other Options */}
      <Box
        sx={{
          borderRadius: 2,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.02)",
          overflow: "hidden"
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid rgba(255, 255, 255, 0.06)", bgcolor: "rgba(255, 255, 255, 0.02)" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.8)" }}>
            Advanced Options
          </Typography>
        </Box>
        <Stack divider={<Box sx={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }} />}>
          {settings.map((setting) => (
            <Box key={setting.name}>
              <input type="hidden" name={`${setting.name}_present`} value="1" />
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2, py: 1.5 }}
              >
                <Box sx={{ pr: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: "rgba(255, 255, 255, 0.9)" }}>
                    {setting.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "rgba(255, 255, 255, 0.5)" }}>
                    {setting.description}
                  </Typography>
                </Box>
                <Switch
                  name={setting.name}
                  checked={values[setting.name as keyof typeof values]}
                  onChange={handleChange(setting.name as keyof typeof values)}
                  size="small"
                  sx={{
                    "& .MuiSwitch-switchBase.Mui-checked": {
                      color: setting.color === "warning"
                        ? "rgba(251, 191, 36, 1)"
                        : "rgba(99, 102, 241, 1)"
                    },
                    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                      backgroundColor: setting.color === "warning"
                        ? "rgba(251, 191, 36, 0.5)"
                        : "rgba(99, 102, 241, 0.5)"
                    }
                  }}
                />
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

const PROTOCOL_OPTIONS = ["http://", "https://"];

type UpstreamEntry = {
  protocol: string;
  address: string;
};

function parseUpstream(upstream: string): UpstreamEntry {
  if (upstream.startsWith("https://")) {
    return { protocol: "https://", address: upstream.slice(8) };
  }
  if (upstream.startsWith("http://")) {
    return { protocol: "http://", address: upstream.slice(7) };
  }
  // Default to http:// if no protocol specified
  return { protocol: "http://", address: upstream };
}

function UpstreamInput({
  defaultUpstreams = [],
  name = "upstreams"
}: {
  defaultUpstreams?: string[];
  name?: string;
}) {
  const initialEntries: UpstreamEntry[] = defaultUpstreams.length > 0
    ? defaultUpstreams.map(parseUpstream)
    : [{ protocol: "http://", address: "" }];

  const [entries, setEntries] = useState<UpstreamEntry[]>(initialEntries);

  const handleProtocolChange = (index: number, newProtocol: string | null) => {
    const updated = [...entries];
    updated[index].protocol = newProtocol || "http://";
    setEntries(updated);
  };

  const handleAddressChange = (index: number, newAddress: string) => {
    const updated = [...entries];
    updated[index].address = newAddress;
    setEntries(updated);
  };

  const handleAdd = () => {
    setEntries([...entries, { protocol: "http://", address: "" }]);
  };

  const handleRemove = (index: number) => {
    if (entries.length === 1) return;
    setEntries(entries.filter((_, i) => i !== index));
  };

  // Serialize entries to a single string for form submission
  const serializedValue = entries
    .filter(e => e.address.trim() !== "")
    .map(e => `${e.protocol}${e.address}`)
    .join("\n");

  return (
    <Box>
      <input type="hidden" name={name} value={serializedValue} />
      <Typography variant="body2" sx={{ mb: 1, color: "rgba(255, 255, 255, 0.7)" }}>
        Upstreams
      </Typography>
      <Stack spacing={1.5}>
        {entries.map((entry, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="flex-start">
            <Autocomplete
              freeSolo
              options={PROTOCOL_OPTIONS}
              value={entry.protocol}
              onChange={(_, newValue) => handleProtocolChange(index, newValue)}
              onInputChange={(_, newInputValue) => {
                if (newInputValue) {
                  handleProtocolChange(index, newInputValue);
                }
              }}
              disableClearable
              sx={{ width: 140 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder="http://"
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      bgcolor: "rgba(20, 20, 22, 0.6)",
                    }
                  }}
                />
              )}
            />
            <TextField
              value={entry.address}
              onChange={(e) => handleAddressChange(index, e.target.value)}
              placeholder="10.0.0.5:8080"
              size="small"
              fullWidth
              required={index === 0}
              sx={{
                "& .MuiOutlinedInput-root": {
                  bgcolor: "rgba(20, 20, 22, 0.6)",
                }
              }}
            />
            <Tooltip title={entries.length === 1 ? "At least one upstream required" : "Remove upstream"}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleRemove(index)}
                  disabled={entries.length === 1}
                  sx={{
                    color: entries.length === 1 ? "rgba(255, 255, 255, 0.2)" : "rgba(239, 68, 68, 0.7)",
                    "&:hover": { bgcolor: "rgba(239, 68, 68, 0.1)" },
                    mt: 0.5
                  }}
                >
                  <RemoveCircleOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
        <Button
          startIcon={<AddIcon />}
          onClick={handleAdd}
          size="small"
          sx={{
            alignSelf: "flex-start",
            color: "rgba(99, 102, 241, 0.9)",
            "&:hover": { bgcolor: "rgba(99, 102, 241, 0.1)" }
          }}
        >
          Add Upstream
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
        Backend servers to proxy requests to (supports load balancing with multiple upstreams)
      </Typography>
    </Box>
  );
}
