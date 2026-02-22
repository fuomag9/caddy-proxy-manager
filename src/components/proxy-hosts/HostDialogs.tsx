
import { Alert, Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useFormState } from "react-dom";
import { useEffect } from "react";
import {
    createProxyHostAction,
    deleteProxyHostAction,
    updateProxyHostAction
} from "@/app/(dashboard)/proxy-hosts/actions";
import { INITIAL_ACTION_STATE } from "@/src/lib/actions";
import { AccessList } from "@/src/lib/models/access-lists";
import { Certificate } from "@/src/lib/models/certificates";
import { ProxyHost } from "@/src/lib/models/proxy-hosts";
import { AuthentikSettings } from "@/src/lib/settings";
import { AppDialog } from "@/src/components/ui/AppDialog";
import { AuthentikFields } from "./AuthentikFields";
import { DnsResolverFields } from "./DnsResolverFields";
import { LoadBalancerFields } from "./LoadBalancerFields";
import { SettingsToggles } from "./SettingsToggles";
import { UpstreamDnsResolutionFields } from "./UpstreamDnsResolutionFields";
import { UpstreamInput } from "./UpstreamInput";

export function CreateHostDialog({
    open,
    onClose,
    certificates,
    accessLists,
    authentikDefaults,
    initialData
}: {
    open: boolean;
    onClose: () => void;
    certificates: Certificate[];
    accessLists: AccessList[];
    authentikDefaults: AuthentikSettings | null;
    initialData?: ProxyHost | null;
}) {
    const [state, formAction] = useFormState(createProxyHostAction, INITIAL_ACTION_STATE);

    useEffect(() => {
        if (state.status === "success") {
            setTimeout(onClose, 1000);
        }
    }, [state.status, onClose]);

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title={initialData ? "Duplicate Proxy Host" : "Create Proxy Host"}
            maxWidth="md"
            submitLabel="Create"
            onSubmit={() => {
                // Trigger generic form submit
                (document.getElementById("create-host-form") as HTMLFormElement)?.requestSubmit();
            }}
        >
            <Stack component="form" id="create-host-form" action={formAction} spacing={2.5}>
                {state.status !== "idle" && state.message && (
                    <Alert severity={state.status === "error" ? "error" : "success"}>
                        {state.message}
                    </Alert>
                )}
                <SettingsToggles
                    hstsSubdomains={initialData?.hsts_subdomains}
                    skipHttpsValidation={initialData?.skip_https_hostname_validation}
                    enabled={true}
                />
                <TextField
                    name="name"
                    label="Name"
                    placeholder="My Service"
                    defaultValue={initialData ? `${initialData.name} (Copy)` : ""}
                    required
                    fullWidth
                />
                <TextField
                    name="domains"
                    label="Domains"
                    placeholder="app.example.com"
                    defaultValue={initialData?.domains.join("\n") ?? ""}
                    helperText="One per line or comma-separated"
                    multiline
                    minRows={2}
                    required
                    fullWidth
                />
                <UpstreamInput defaultUpstreams={initialData?.upstreams} />
                <TextField select name="certificate_id" label="Certificate" defaultValue={initialData?.certificate_id ?? ""} fullWidth>
                    <MenuItem value="">Managed by Caddy (Auto)</MenuItem>
                    {certificates.map((cert) => (
                        <MenuItem key={cert.id} value={cert.id}>
                            {cert.name}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField select name="access_list_id" label="Access List" defaultValue={initialData?.access_list_id ?? ""} fullWidth>
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
                    defaultValue={initialData?.custom_pre_handlers_json ?? ""}
                    helperText="Optional JSON array of Caddy handlers"
                    multiline
                    minRows={3}
                    fullWidth
                />
                <TextField
                    name="custom_reverse_proxy_json"
                    label="Custom Reverse Proxy (JSON)"
                    placeholder='{"headers": {"request": {...}}}'
                    defaultValue={initialData?.custom_reverse_proxy_json ?? ""}
                    helperText="Deep-merge into reverse_proxy handler (only applies in proxy mode)"
                    multiline
                    minRows={3}
                    fullWidth
                />
                <AuthentikFields defaults={authentikDefaults} authentik={initialData?.authentik} />
                <LoadBalancerFields loadBalancer={initialData?.load_balancer} />
                <DnsResolverFields dnsResolver={initialData?.dns_resolver} />
                <UpstreamDnsResolutionFields upstreamDnsResolution={initialData?.upstream_dns_resolution} />
            </Stack>
        </AppDialog>
    );
}

export function EditHostDialog({
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
            setTimeout(onClose, 1000);
        }
    }, [state.status, onClose]);

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title="Edit Proxy Host"
            maxWidth="md"
            submitLabel="Save Changes"
            onSubmit={() => {
                (document.getElementById("edit-host-form") as HTMLFormElement)?.requestSubmit();
            }}
        >
            <Stack component="form" id="edit-host-form" action={formAction} spacing={2.5}>
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
                    helperText="Deep-merge into reverse_proxy handler (only applies in proxy mode)"
                    multiline
                    minRows={3}
                    fullWidth
                />
                <AuthentikFields authentik={host.authentik} />
                <LoadBalancerFields loadBalancer={host.load_balancer} />
                <DnsResolverFields dnsResolver={host.dns_resolver} />
                <UpstreamDnsResolutionFields upstreamDnsResolution={host.upstream_dns_resolution} />
            </Stack>
        </AppDialog>
    );
}

export function DeleteHostDialog({
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
            setTimeout(onClose, 1000);
        }
    }, [state.status, onClose]);

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title="Delete Proxy Host"
            maxWidth="sm"
            submitLabel="Delete"
            onSubmit={() => {
                (document.getElementById("delete-host-form") as HTMLFormElement)?.requestSubmit();
            }}
        >
            <Stack component="form" id="delete-host-form" action={formAction} spacing={2}>
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
                <Typography variant="body2" color="error.main" fontWeight={500}>
                    This action cannot be undone.
                </Typography>
            </Stack>
        </AppDialog>
    );
}
