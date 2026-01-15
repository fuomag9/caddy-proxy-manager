
import { Box, Checkbox, Collapse, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { AuthentikSettings } from "@/src/lib/settings";
import { ProxyHost } from "@/src/lib/models/proxy-hosts";

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

export function AuthentikFields({
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
                border: "1px solid",
                borderColor: "primary.main",
                bgcolor: "rgba(99, 102, 241, 0.05)",
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
                        <Typography variant="body2" color="text.secondary">
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
                            fullWidth
                        />
                        <TextField
                            name="authentik_outpost_upstream"
                            label="Outpost Upstream URL"
                            placeholder="https://outpost.internal:9000"
                            defaultValue={initial?.outpostUpstream ?? defaults?.outpostUpstream ?? ""}
                            required={enabled}
                            disabled={!enabled}
                            fullWidth
                        />
                        {/* ... other fields ... */}
                        <TextField
                            name="authentik_auth_endpoint"
                            label="Auth Endpoint (Optional)"
                            placeholder="/outpost.goauthentik.io/auth/caddy"
                            defaultValue={initial?.authEndpoint ?? defaults?.authEndpoint ?? ""}
                            disabled={!enabled}
                            fullWidth
                        />
                        <TextField
                            name="authentik_copy_headers"
                            label="Headers to Copy"
                            defaultValue={copyHeadersValue}
                            disabled={!enabled}
                            multiline
                            minRows={3}
                            fullWidth
                        />
                        <TextField
                            name="authentik_trusted_proxies"
                            label="Trusted Proxies"
                            defaultValue={trustedProxiesValue}
                            disabled={!enabled}
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
