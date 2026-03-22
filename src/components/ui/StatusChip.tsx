import { cn } from "@/lib/utils";

type StatusType = "active" | "inactive" | "error" | "warning";

type StatusChipProps = {
  status: StatusType;
  label?: string;
  className?: string;
};

const STATUS_CONFIG: Record<StatusType, { dot: string; text: string; label: string }> = {
  active:   { dot: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]",  text: "text-green-500",  label: "Active"  },
  inactive: { dot: "bg-zinc-500",                                          text: "text-zinc-600 dark:text-zinc-400",   label: "Paused"  },
  error:    { dot: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",    text: "text-red-500",    label: "Error"   },
  warning:  { dot: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]", text: "text-amber-500",  label: "Warning" },
};

export function StatusChip({ status, label, className }: StatusChipProps) {
  const config = STATUS_CONFIG[status];
  const displayLabel = label ?? config.label;

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
      "bg-muted/30 border border-border",
      className
    )}>
      <span className={cn("w-2 h-2 rounded-full shrink-0", config.dot)} />
      <span className={cn("text-xs font-semibold leading-none", config.text)}>
        {displayLabel}
      </span>
    </span>
  );
}
