"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart2, Activity } from "lucide-react";
import { ReactNode } from "react";

type StatCard = {
  label: string;
  icon: ReactNode;
  count: number;
  href: string;
};

type RecentEvent = {
  summary: string;
  createdAt: string;
};

type TrafficSummary = {
  totalRequests: number;
  blockedPercent: number;
} | null;

// Per-position accent colors for stat cards (proxy hosts, certs, access lists, traffic)
const CARD_ACCENTS = [
  { border: "border-l-violet-500", icon: "border-violet-500/30 bg-violet-500/10 text-violet-500", count: "text-violet-600 dark:text-violet-400" },
  { border: "border-l-emerald-500", icon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500", count: "text-emerald-600 dark:text-emerald-400" },
  { border: "border-l-amber-500", icon: "border-amber-500/30 bg-amber-500/10 text-amber-500", count: "text-amber-600 dark:text-amber-400" },
];

const TRAFFIC_ACCENT = {
  border: "border-l-cyan-500",
  icon: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500",
  count: "text-cyan-600 dark:text-cyan-400",
};

function getEventDotColor(summary: string): string {
  const lower = summary.toLowerCase();
  if (lower.startsWith("delete") || lower.startsWith("remove")) return "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]";
  if (lower.startsWith("create") || lower.startsWith("add")) return "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]";
  return "bg-primary shadow-[0_0_6px_var(--primary)]";
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function OverviewClient({
  userName,
  stats,
  trafficSummary,
  recentEvents,
  isAdmin = true
}: {
  userName: string;
  stats: StatCard[];
  trafficSummary: TrafficSummary;
  recentEvents: RecentEvent[];
  isAdmin?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, <span className="text-primary">{userName}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything you need to orchestrate Caddy proxies, certificates, and secure edge services.
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
          return (
            <Link key={stat.label} href={stat.href} className="block group">
              <Card className={`border-l-2 ${accent.border} hover:bg-muted/40 transition-colors`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.icon} transition-transform group-hover:scale-110`}>
                      {stat.icon}
                    </div>
                    <span className={`text-3xl font-bold tabular-nums ${accent.count}`}>
                      {stat.count}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-muted-foreground mt-3">{stat.label}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {/* Traffic (24h) card — admin only */}
        {isAdmin && (
          <Link href="/analytics" className="block group">
            <Card className={`border-l-2 ${TRAFFIC_ACCENT.border} hover:bg-muted/40 transition-colors`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${TRAFFIC_ACCENT.icon} transition-transform group-hover:scale-110`}>
                    <BarChart2 className="h-4 w-4" />
                  </div>
                  <span className={`text-3xl font-bold tabular-nums ${TRAFFIC_ACCENT.count}`}>
                    {trafficSummary ? trafficSummary.totalRequests.toLocaleString() : "—"}
                  </span>
                </div>
                <p className="text-sm font-medium text-muted-foreground mt-3">Traffic (24h)</p>
                {trafficSummary && trafficSummary.totalRequests > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Blocked</span>
                      <span className={`text-xs font-semibold tabular-nums ${trafficSummary.blockedPercent > 0 ? "text-rose-500" : "text-muted-foreground"}`}>
                        {trafficSummary.blockedPercent}%
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all"
                        style={{ width: `${Math.min(trafficSummary.blockedPercent, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {/* Recent Activity — admin only */}
      {isAdmin && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h2>
          </div>

          <Card>
            <CardContent className="p-0">
              {recentEvents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <div className="relative">
                  {/* Vertical timeline line */}
                  <div className="absolute left-[28px] top-4 bottom-4 w-px bg-border" />
                  {recentEvents.map((event, index) => (
                    <div
                      key={`${event.createdAt}-${index}`}
                      className="relative flex items-start gap-4 px-5 py-3 hover:bg-muted/30 transition-colors"
                    >
                      {/* Dot */}
                      <div className={`relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full ${getEventDotColor(event.summary)}`} />
                      <span className="flex-1 text-sm leading-snug">{event.summary}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatRelativeTime(event.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
