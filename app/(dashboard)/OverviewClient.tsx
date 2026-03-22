"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart2 } from "lucide-react";
import { ReactNode } from "react";

type StatCard = {
  label: string;
  icon: ReactNode;
  count: number;
  href: string;
};

type RecentEvent = {
  summary: string;
  created_at: string;
};

type TrafficSummary = {
  totalRequests: number;
  blockedPercent: number;
} | null;

export default function OverviewClient({
  userName,
  stats,
  trafficSummary,
  recentEvents
}: {
  userName: string;
  stats: StatCard[];
  trafficSummary: TrafficSummary;
  recentEvents: RecentEvent[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400/60">
          Control Center
        </span>
        <h1
          className="text-3xl font-bold"
          style={{
            background: "linear-gradient(120deg, rgba(127, 91, 255, 1) 0%, rgba(34, 211, 238, 0.9) 80%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}
        >
          Welcome back, {userName}
        </h1>
        <p className="text-sm text-muted-foreground max-w-[560px]">
          Everything you need to orchestrate Caddy proxies, certificates, and secure edge services lives here.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="border border-slate-400/10 bg-transparent shadow-none h-full"
          >
            <Link
              href={stat.href}
              className="block h-full transition-colors hover:bg-gradient-to-br hover:from-violet-500/10 hover:to-cyan-400/[0.06] rounded-[inherit]"
            >
              <CardContent className="flex flex-col gap-1 pt-6">
                <div className="text-violet-400/80 flex items-center">
                  {stat.icon}
                </div>
                <span className="text-3xl font-bold tracking-tight">
                  {stat.count}
                </span>
                <span className="text-sm text-muted-foreground font-medium">
                  {stat.label}
                </span>
              </CardContent>
            </Link>
          </Card>
        ))}

        {/* Traffic (24h) card */}
        <Card className="border border-slate-400/10 bg-transparent shadow-none h-full">
          <Link
            href="/analytics"
            className="block h-full transition-colors hover:bg-gradient-to-br hover:from-violet-500/10 hover:to-cyan-400/[0.06] rounded-[inherit]"
          >
            <CardContent className="flex flex-col gap-1 pt-6">
              <div className="text-violet-400/80 flex items-center">
                <BarChart2 className="h-8 w-8" />
              </div>
              {trafficSummary ? (
                <>
                  <span className="text-3xl font-bold tracking-tight">
                    {trafficSummary.totalRequests.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground font-medium">
                    Traffic (24h)
                    {trafficSummary.totalRequests > 0 && (
                      <span
                        className={`ml-1 text-[0.8em] ${trafficSummary.blockedPercent > 0 ? "text-red-400" : "text-muted-foreground"}`}
                      >
                        · {trafficSummary.blockedPercent}% blocked
                      </span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-3xl font-bold tracking-tight">—</span>
                  <span className="text-sm text-muted-foreground font-medium">Traffic (24h)</span>
                </>
              )}
            </CardContent>
          </Link>
        </Card>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Recent Activity</h2>
        {recentEvents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground rounded-md bg-[rgba(12,18,30,0.7)]">
            No activity recorded yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recentEvents.map((event, index) => (
              <div
                key={`${event.created_at}-${index}`}
                className="flex justify-between items-center gap-2 rounded-md p-4 border border-slate-400/[0.08]"
                style={{ background: "linear-gradient(120deg, rgba(17, 25, 40, 0.9), rgba(15, 23, 42, 0.7))" }}
              >
                <span className="text-sm font-medium">{event.summary}</span>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
