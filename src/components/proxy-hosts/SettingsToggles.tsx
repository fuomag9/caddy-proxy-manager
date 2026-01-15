
import { Box, Stack, Switch, Typography } from "@mui/material";
import { useState } from "react";

type ToggleSetting = {
    name: string;
    label: string;
    description: string;
    defaultChecked: boolean;
    color?: "success" | "warning" | "default";
};

type SettingsTogglesProps = {
    hstsSubdomains?: boolean;
    skipHttpsValidation?: boolean;
    enabled?: boolean;
};

export function SettingsToggles({
    hstsSubdomains = false,
    skipHttpsValidation = false,
    enabled = true
}: SettingsTogglesProps) {
    const [values, setValues] = useState({
        hsts_subdomains: hstsSubdomains,
        skip_https_hostname_validation: skipHttpsValidation,
        enabled: enabled
    });

    const handleChange = (name: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
        setValues(prev => ({ ...prev, [name]: event.target.checked }));
    };

    const handleEnabledChange = (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
        setValues(prev => ({ ...prev, enabled: checked }));
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
        <Stack spacing={3}>
            <input type="hidden" name="enabled_present" value="1" />
            <input type="hidden" name="enabled" value={values.enabled ? "on" : ""} />

            {/* Main Enable Switch */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                    p: 2,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: values.enabled ? "primary.main" : "divider",
                    bgcolor: values.enabled ? "rgba(99, 102, 241, 0.04)" : "background.paper",
                    transition: "all 0.2s ease"
                }}
            >
                <Box>
                    <Typography variant="subtitle1" fontWeight={600} color={values.enabled ? "primary.main" : "text.primary"}>
                        {values.enabled ? "Proxy Host Enabled" : "Proxy Host Paused"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {values.enabled
                            ? "This host is active and routing traffic"
                            : "This host is disabled and will not respond to requests"}
                    </Typography>
                </Box>
                <Switch
                    checked={values.enabled}
                    onChange={handleEnabledChange}
                    color="primary"
                />
            </Stack>

            {/* Advanced Options */}
            <Box
                sx={{
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    overflow: "hidden"
                }}
            >
                <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "rgba(255,255,255,0.02)" }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                        Advanced Options
                    </Typography>
                </Box>
                <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
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
                                    <Typography variant="body2" fontWeight={500}>
                                        {setting.label}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {setting.description}
                                    </Typography>
                                </Box>
                                <Switch
                                    name={setting.name}
                                    checked={values[setting.name as keyof typeof values] as boolean}
                                    onChange={handleChange(setting.name as keyof typeof values)}
                                    size="small"
                                    color={setting.color as any}
                                />
                            </Stack>
                        </Box>
                    ))}
                </Stack>
            </Box>
        </Stack>
    );
}
