"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Stack, Typography } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";

type PortsDiff = {
  currentPorts: string[];
  requiredPorts: string[];
  needsApply: boolean;
};

type PortsStatus = {
  state: "idle" | "pending" | "applying" | "applied" | "failed";
  message?: string;
  appliedAt?: string;
  error?: string;
};

type PortsResponse = {
  diff: PortsDiff;
  status: PortsStatus;
  error?: string;
};

export function L4PortsApplyBanner() {
  const [data, setData] = useState<PortsResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const [polling, setPolling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/l4-ports");
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // ignore fetch errors
    }
  }, []);

  // Initial fetch and poll when pending/applying
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!data) return;
    const shouldPoll = data.status.state === "pending" || data.status.state === "applying";
    if (shouldPoll && !polling) {
      setPolling(true);
      const interval = setInterval(fetchStatus, 2000);
      return () => { clearInterval(interval); setPolling(false); };
    }
    if (!shouldPoll && polling) {
      setPolling(false);
    }
  }, [data, polling, fetchStatus]);

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/l4-ports", { method: "POST" });
      if (res.ok) {
        await fetchStatus();
      }
    } catch {
      // ignore
    } finally {
      setApplying(false);
    }
  };

  if (!data) return null;

  const { diff, status } = data;

  // Show nothing if no changes needed and status is idle/applied
  if (!diff.needsApply && (status.state === "idle" || status.state === "applied")) {
    return null;
  }

  const stateIcon = {
    idle: null,
    pending: <CircularProgress size={16} />,
    applying: <CircularProgress size={16} />,
    applied: <CheckCircleIcon color="success" fontSize="small" />,
    failed: <ErrorIcon color="error" fontSize="small" />,
  }[status.state];

  const severity = status.state === "failed" ? "error"
    : status.state === "applied" ? "success"
    : diff.needsApply ? "warning"
    : "info";

  return (
    <Alert
      severity={severity}
      icon={stateIcon || undefined}
      action={
        diff.needsApply ? (
          <Button
            color="inherit"
            size="small"
            onClick={handleApply}
            disabled={applying || status.state === "pending" || status.state === "applying"}
            startIcon={applying ? <CircularProgress size={14} /> : <SyncIcon />}
          >
            Apply Ports
          </Button>
        ) : undefined
      }
    >
      <Stack spacing={0.5}>
        {diff.needsApply ? (
          <Typography variant="body2">
            <strong>Docker port changes pending.</strong> The caddy container needs to be recreated to expose L4 ports.
            {diff.requiredPorts.length > 0 && (
              <> Required: {diff.requiredPorts.map(p => (
                <Chip key={p} label={p} size="small" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: "0.7rem" }} />
              ))}</>
            )}
          </Typography>
        ) : (
          <Typography variant="body2">{status.message}</Typography>
        )}
        {status.state === "failed" && status.error && (
          <Typography variant="caption" color="error.main">{status.error}</Typography>
        )}
      </Stack>
    </Alert>
  );
}
