"use client";

import { Chip, Stack } from "@mui/material";

type Props = {
  expired: number;
  expiringSoon: number;
  healthy: number;
  filter: string | null;
  onFilter: (f: string | null) => void;
};

export function StatusSummaryBar({ expired, expiringSoon, healthy, filter, onFilter }: Props) {
  function toggle(key: string) {
    onFilter(filter === key ? null : key);
  }

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap">
      <Chip
        label={`${expired} expired`}
        color="error"
        variant={filter === "expired" ? "filled" : "outlined"}
        onClick={() => toggle("expired")}
        clickable
        size="small"
      />
      <Chip
        label={`${expiringSoon} expiring soon`}
        color="warning"
        variant={filter === "expiring_soon" ? "filled" : "outlined"}
        onClick={() => toggle("expiring_soon")}
        clickable
        size="small"
      />
      <Chip
        label={`${healthy} healthy`}
        color="success"
        variant={filter === "ok" ? "filled" : "outlined"}
        onClick={() => toggle("ok")}
        clickable
        size="small"
      />
    </Stack>
  );
}
