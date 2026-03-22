import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
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

const MAX_WIDTH_CLASS: Record<NonNullable<AppDialogProps["maxWidth"]>, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
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
  isSubmitting = false,
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={MAX_WIDTH_CLASS[maxWidth]}>
        <DialogHeader className="flex flex-row items-center justify-between pr-6">
          <DialogTitle>{title}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 h-6 w-6"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="overflow-y-auto py-4 px-1">{children}</div>

        <DialogFooter>
          {actions ?? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {onSubmit && (
                <Button onClick={onSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                      Saving…
                    </>
                  ) : (
                    submitLabel
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
