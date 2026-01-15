
import { Box, Typography, ChipProps } from "@mui/material";

type StatusType = "active" | "inactive" | "error" | "warning";

type StatusChipProps = {
    status: StatusType;
    label?: string;
    sx?: any;
};

const STATUS_CONFIG: Record<StatusType, { color: string; label: string }> = {
    active: { color: "#22c55e", label: "Active" },   // Green-500
    inactive: { color: "#71717a", label: "Paused" }, // Zinc-500
    error: { color: "#ef4444", label: "Error" },     // Red-500
    warning: { color: "#f59e0b", label: "Warning" }  // Amber-500
};

export function StatusChip({ status, label, sx }: StatusChipProps) {
    const config = STATUS_CONFIG[status];
    const displayLabel = label || config.label;

    return (
        <Box
            sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.5,
                borderRadius: "9999px",
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                ...sx
            }}
        >
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: config.color,
                    boxShadow: `0 0 8px ${config.color}66`
                }}
            />
            <Typography
                variant="caption"
                sx={{
                    fontWeight: 600,
                    color: "text.primary",
                    lineHeight: 1
                }}
            >
                {displayLabel}
            </Typography>
        </Box>
    );
}
