"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-wrap gap-2">
      <button onClick={() => toggle("expired")} aria-pressed={filter === "expired"}>
        <Badge
          variant={filter === "expired" ? "destructive" : "outline"}
          className={cn(
            "cursor-pointer",
            filter !== "expired" && "border-destructive text-destructive hover:bg-destructive/10"
          )}
        >
          {expired} expired
        </Badge>
      </button>
      <button onClick={() => toggle("expiring_soon")} aria-pressed={filter === "expiring_soon"}>
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer",
            filter === "expiring_soon"
              ? "bg-yellow-500 text-white border-yellow-500 hover:bg-yellow-600"
              : "border-yellow-500 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
          )}
        >
          {expiringSoon} expiring soon
        </Badge>
      </button>
      <button onClick={() => toggle("ok")} aria-pressed={filter === "ok"}>
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer",
            filter === "ok"
              ? "bg-green-600 text-white border-green-600 hover:bg-green-700"
              : "border-green-600 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
          )}
        >
          {healthy} healthy
        </Badge>
      </button>
    </div>
  );
}
