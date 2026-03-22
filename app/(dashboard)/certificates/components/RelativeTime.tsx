"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CertExpiryStatus } from "../page";

function formatRelative(validTo: string): string {
  const diff = new Date(validTo).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor(absDiff / 3600000);

  if (diff < 0) {
    if (days >= 1) return `EXPIRED ${days} day${days !== 1 ? "s" : ""} ago`;
    return `EXPIRED ${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  if (days >= 1) return `in ${days} day${days !== 1 ? "s" : ""}`;
  return `in ${hours} hour${hours !== 1 ? "s" : ""}`;
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
    return (
      <p className="text-sm text-muted-foreground">—</p>
    );
  }

  const colorClass =
    status === "expired"
      ? "text-destructive"
      : status === "expiring_soon"
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-green-600 dark:text-green-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className={`text-sm font-medium cursor-default ${colorClass}`}>
          {formatRelative(validTo)}
        </p>
      </TooltipTrigger>
      <TooltipContent>{formatFull(validTo)}</TooltipContent>
    </Tooltip>
  );
}
