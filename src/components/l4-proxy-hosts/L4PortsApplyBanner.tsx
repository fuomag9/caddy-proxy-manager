"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

export function L4PortsApplyBanner({ refreshSignal }: { refreshSignal?: number }) {
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

  // Initial fetch on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Re-fetch when the parent signals a mutation (create/edit/delete/toggle)
  useEffect(() => {
    if (!refreshSignal) return;
    fetchStatus();
  }, [refreshSignal, fetchStatus]);

  useEffect(() => {
    if (!data) return;
    const shouldPoll =
      data.status.state === "pending" || data.status.state === "applying";
    if (shouldPoll && !polling) {
      setPolling(true);
      const interval = setInterval(fetchStatus, 2000);
      return () => {
        clearInterval(interval);
        setPolling(false);
      };
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

  const isSpinning =
    status.state === "pending" || status.state === "applying";

  const alertVariant: "default" | "destructive" =
    status.state === "failed" ? "destructive" : "default";

  const stateIcon =
    status.state === "applied" ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : status.state === "failed" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : isSpinning ? (
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    ) : null;

  return (
    <Alert
      variant={alertVariant}
      className={cn(
        "flex items-start gap-3",
        status.state === "applied" && "border-green-500/50 text-green-700 dark:text-green-400",
        diff.needsApply && status.state !== "failed" && status.state !== "applied" && "border-yellow-500/50 text-yellow-800 dark:text-yellow-400"
      )}
    >
      {stateIcon && <div className="mt-0.5 shrink-0">{stateIcon}</div>}
      <AlertDescription className="flex-1">
        <div className="flex flex-col gap-1">
          {diff.needsApply ? (
            <p className="text-sm">
              <strong>Docker port changes pending.</strong> The caddy container
              needs to be recreated to expose L4 ports.
              {diff.requiredPorts.length > 0 && (
                <span className="inline-flex items-center gap-1 ml-1 flex-wrap">
                  Required:{" "}
                  {diff.requiredPorts.map((p) => (
                    <Badge
                      key={p}
                      variant="outline"
                      className="text-[0.7rem] h-5 px-1.5"
                    >
                      {p}
                    </Badge>
                  ))}
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm">{status.message}</p>
          )}
          {status.state === "failed" && status.error && (
            <p className="text-xs text-destructive">{status.error}</p>
          )}
        </div>
      </AlertDescription>
      {diff.needsApply && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleApply}
          disabled={
            applying ||
            status.state === "pending" ||
            status.state === "applying"
          }
          className="shrink-0 ml-auto"
        >
          {applying ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent mr-1.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Apply Ports
        </Button>
      )}
    </Alert>
  );
}
