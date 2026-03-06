"use client";

import { Tooltip, Typography } from "@mui/material";
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
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }

  const color =
    status === "expired"
      ? "error.main"
      : status === "expiring_soon"
        ? "warning.main"
        : "success.main";

  return (
    <Tooltip title={formatFull(validTo)}>
      <Typography variant="body2" sx={{ color, fontWeight: 500, cursor: "default" }}>
        {formatRelative(validTo)}
      </Typography>
    </Tooltip>
  );
}
