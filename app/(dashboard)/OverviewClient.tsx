"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart2 } from "lucide-react";
import { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

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
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {userName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything you need to orchestrate Caddy proxies, certificates, and secure edge services.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block">
            <Card className="hover:bg-muted/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <div className="text-muted-foreground">
                  {stat.icon}
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.count}</div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Traffic (24h) card */}
        <Link href="/analytics" className="block">
          <Card className="hover:bg-muted/50 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Traffic (24h)
              </CardTitle>
              <div className="text-muted-foreground">
                <BarChart2 className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {trafficSummary ? (
                <>
                  <div className="text-3xl font-bold">
                    {trafficSummary.totalRequests.toLocaleString()}
                  </div>
                  {trafficSummary.totalRequests > 0 && (
                    <p className={`text-xs mt-1 ${trafficSummary.blockedPercent > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {trafficSummary.blockedPercent}% blocked
                    </p>
                  )}
                </>
              ) : (
                <div className="text-3xl font-bold">—</div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentEvents.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div>
              {recentEvents.map((event, index) => (
                <div key={`${event.created_at}-${index}`}>
                  {index > 0 && <Separator />}
                  <div className="flex justify-between items-center gap-4 px-6 py-3">
                    <span className="text-sm">{event.summary}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
