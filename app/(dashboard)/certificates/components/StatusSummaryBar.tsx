"use client";

import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  expired: number;
  expiringSoon: number;
  healthy: number;
  filter: string | null;
  onFilter: (f: string | null) => void;
};

type StatChipProps = {
  icon: React.ReactNode;
  count: number;
  label: string;
  active: boolean;
  onClick: () => void;
  base: string;
  activeStyle: string;
};

function StatChip({ icon, count, label, active, onClick, base, activeStyle }: StatChipProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all cursor-pointer select-none",
        active ? activeStyle : base,
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="text-lg font-bold tabular-nums leading-none">{count}</span>
      <span className="text-xs leading-none opacity-80">{label}</span>
    </button>
  );
}

export function StatusSummaryBar({ expired, expiringSoon, healthy, filter, onFilter }: Props) {
  function toggle(key: string) {
    onFilter(filter === key ? null : key);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <StatChip
        icon={<AlertCircle className="h-4 w-4" />}
        count={expired}
        label="Expired"
        active={filter === "expired"}
        onClick={() => toggle("expired")}
        base="border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15"
        activeStyle="border-rose-500 bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.3)]"
      />
      <StatChip
        icon={<Clock className="h-4 w-4" />}
        count={expiringSoon}
        label="Expiring soon"
        active={filter === "expiring_soon"}
        onClick={() => toggle("expiring_soon")}
        base="border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
        activeStyle="border-amber-500 bg-amber-500 text-white shadow-[0_0_12px_rgba(245,158,11,0.3)]"
      />
      <StatChip
        icon={<CheckCircle2 className="h-4 w-4" />}
        count={healthy}
        label="Healthy"
        active={filter === "ok"}
        onClick={() => toggle("ok")}
        base="border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
        activeStyle="border-emerald-500 bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]"
      />
    </div>
  );
}
