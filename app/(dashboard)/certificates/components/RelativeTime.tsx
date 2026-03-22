"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { CertExpiryStatus } from "../page";

function formatRelative(validTo: string): string {
  const diff = new Date(validTo).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor(absDiff / 3600000);

  if (diff < 0) {
    if (days >= 1) return `Expired ${days}d ago`;
    return `Expired ${hours}h ago`;
  }
  if (days >= 1) return `${days}d`;
  return `${hours}h`;
}

function formatFull(validTo: string): string {
  return new Date(validTo).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RelativeTime({
  validTo,
  status,
}: {
  validTo: string | null;
  status: CertExpiryStatus | null;
}) {
  if (validTo === null || status === null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const config =
    status === "expired"
      ? {
          icon: <AlertCircle className="h-3.5 w-3.5" />,
          cls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
        }
      : status === "expiring_soon"
        ? {
            icon: <Clock className="h-3.5 w-3.5" />,
            cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          }
        : {
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold cursor-default ${config.cls}`}>
          {config.icon}
          {formatRelative(validTo)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{formatFull(validTo)}</TooltipContent>
    </Tooltip>
  );
}
