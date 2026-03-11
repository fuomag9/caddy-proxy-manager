
import { Box, Button, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { ReactNode } from "react";

type PageHeaderProps = {
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
    };
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
    return (
        <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "flex-start" }}
            spacing={2}
            sx={{ mb: 4 }}
        >
            <Stack spacing={1}>
                <Typography variant="h4" color="text.primary">
                    {title}
                </Typography>
                {description && (
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
                        {description}
                    </Typography>
                )}
            </Stack>
            {action && (
                <Button
                    variant="contained"
                    startIcon={action.icon ?? <AddIcon />}
                    onClick={action.onClick}
                    color="primary"
                    sx={{ fontWeight: 600 }}
                >
                    {action.label}
                </Button>
            )}
        </Stack>
    );
}
