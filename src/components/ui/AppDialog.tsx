
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Typography,
    Button
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ReactNode } from "react";

type AppDialogProps = {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
    actions?: ReactNode;
    submitLabel?: string;
    onSubmit?: () => void;
    isSubmitting?: boolean;
};

export function AppDialog({
    open,
    onClose,
    title,
    children,
    maxWidth = "sm",
    actions,
    submitLabel = "Save",
    onSubmit,
    isSubmitting = false
}: AppDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={maxWidth}
            fullWidth
            PaperProps={{
                elevation: 0,
                variant: "outlined"
            }}
        >
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="h6">{title}</Typography>
                <IconButton onClick={onClose} size="small" sx={{ color: "text.secondary" }}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {children}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                {actions ? actions : (
                    <>
                        <Button onClick={onClose} color="inherit">
                            Cancel
                        </Button>
                        {onSubmit && (
                            <Button
                                onClick={onSubmit}
                                variant="contained"
                                disabled={isSubmitting}
                            >
                                {submitLabel}
                            </Button>
                        )}
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}
