'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Check, ChevronsUpDown, X } from 'lucide-react';
import type { ApexOptions } from 'apexcharts';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ── Dynamic imports (browser-only) ────────────────────────────────────────────

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

const WorldMap = dynamic(() => import('./WorldMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center items-center h-[240px]">
      <span className="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
    </div>
  ),
}) as React.ComponentType<{ data: import('./WorldMapInner').CountryStats[]; selectedCountry?: string | null }>;

// ── Types (mirrored from analytics-db — can't import server-only code) ────────

type Interval = '1h' | '12h' | '24h' | '7d' | '30d';
type DisplayInterval = Interval | 'custom';

const INTERVAL_SECONDS_CLIENT: Record<Interval, number> = {
  '1h': 3600, '12h': 43200, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400,
};


interface AnalyticsSummary {
  totalRequests: number;
  uniqueIps: number;
  blockedRequests: number;
  blockedPercent: number;
  bytesServed: number;
  loggingDisabled: boolean;
}

interface TimelineBucket { ts: number; total: number; blocked: number; }
interface CountryStats { countryCode: string; total: number; blocked: number; }
interface ProtoStats { proto: string; count: number; percent: number; }
interface UAStats { userAgent: string; count: number; percent: number; }

interface BlockedEvent {
  id: number; ts: number; clientIp: string; countryCode: string | null;
  method: string; uri: string; status: number; host: string;
}
interface BlockedPage { events: BlockedEvent[]; total: number; page: number; pages: number; }

interface TopWafRule { ruleId: number; count: number; message: string | null; hosts: { host: string; count: number }[]; }
interface WafStats { total: number; topRules: TopWafRule[]; byCountry: { countryCode: string; count: number }[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function parseUA(ua: string): string {
  if (!ua) return 'Unknown';
  if (/Googlebot/i.test(ua)) return 'Googlebot';
  if (/bingbot/i.test(ua)) return 'Bingbot';
  if (/DuckDuckBot/i.test(ua)) return 'DuckDuckBot';
  if (/curl/i.test(ua)) return 'curl';
  if (/python-requests|Python\//i.test(ua)) return 'Python';
  if (/Go-http-client/i.test(ua)) return 'Go';
  if (/wget/i.test(ua)) return 'wget';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Browser';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return ua.substring(0, 32);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTs(ts: number, rangeSeconds: number): string {
  const d = new Date(ts * 1000);
  if (rangeSeconds <= 86400) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (rangeSeconds <= 7 * 86400) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const DARK_CHART: ApexOptions = {
  chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
  theme: { mode: 'dark' },
  grid: { borderColor: 'rgba(255,255,255,0.06)' },
  tooltip: { theme: 'dark' },
};

// ── Local DateTimePicker ───────────────────────────────────────────────────────

function DateTimePicker({
  value,
  onChange,
  placeholder,
}: {
  value: Dayjs | null;
  onChange: (v: Dayjs | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [timeStr, setTimeStr] = useState(value ? value.format('HH:mm') : '00:00');

  // Keep timeStr in sync when value changes externally
  useEffect(() => {
    if (value) setTimeStr(value.format('HH:mm'));
  }, [value]);

  const selectedDate = value ? value.toDate() : undefined;

  function handleDaySelect(day: Date | undefined) {
    if (!day) return;
    const [hh, mm] = timeStr.split(':').map(Number);
    const next = dayjs(day).hour(hh || 0).minute(mm || 0).second(0);
    onChange(next);
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTimeStr(e.target.value);
    if (value) {
      const [hh, mm] = e.target.value.split(':').map(Number);
      onChange(value.hour(hh || 0).minute(mm || 0).second(0));
    }
  }

  const label = value ? value.format('DD/MM/YYYY HH:mm') : (placeholder ?? 'Pick date & time');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-[180px] justify-start text-left font-normal text-xs">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDaySelect}
          initialFocus
        />
        <div className="flex items-center gap-2 px-3 pb-3">
          <span className="text-xs text-muted-foreground">Time:</span>
          <input
            type="time"
            value={timeStr}
            onChange={handleTimeChange}
            className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="h-full rounded-lg border border-white/[0.12] p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Hosts multi-select combobox ───────────────────────────────────────────────

function HostsCombobox({
  allHosts,
  selectedHosts,
  onChange,
}: {
  allHosts: string[];
  selectedHosts: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(host: string) {
    if (selectedHosts.includes(host)) {
      onChange(selectedHosts.filter(h => h !== host));
    } else {
      onChange([...selectedHosts, host]);
    }
  }

  const label =
    selectedHosts.length === 0
      ? 'All hosts'
      : selectedHosts.length <= 2
        ? selectedHosts.join(', ')
        : `${selectedHosts.length} hosts`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="w-[220px] justify-between text-xs font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search hosts..." className="text-xs" />
          <div className="flex items-center gap-1 border-b px-2 py-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground px-1"
              onMouseDown={e => { e.preventDefault(); onChange(allHosts); }}
            >
              Select all
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground px-1"
              onMouseDown={e => { e.preventDefault(); onChange([]); }}
            >
              Clear
            </button>
          </div>
          <CommandList>
            <CommandEmpty>No hosts found.</CommandEmpty>
            <CommandGroup>
              {allHosts.map(host => (
                <CommandItem key={host} value={host} onSelect={() => toggle(host)} className="text-xs">
                  <Check
                    className={cn('mr-2 h-3 w-3', selectedHosts.includes(host) ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{host}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selectedHosts.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t px-2 py-2 max-h-24 overflow-y-auto">
            {selectedHosts.length <= 2
              ? selectedHosts.map(h => (
                  <Badge key={h} variant="secondary" className="text-xs gap-1">
                    <span className="max-w-[80px] truncate">{h}</span>
                    <button onMouseDown={e => { e.preventDefault(); toggle(h); }}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))
              : (
                  <Badge variant="secondary" className="text-xs gap-1">
                    {selectedHosts.length} hosts
                    <button onMouseDown={e => { e.preventDefault(); onChange([]); }}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                )
            }
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsClient() {
  const [interval, setIntervalVal] = useState<DisplayInterval>('1h');
  const [selectedHosts, setSelectedHosts] = useState<string[]>([]);
  const [allHosts, setAllHosts] = useState<string[]>([]);

  // Custom range as Dayjs objects
  const [customFrom, setCustomFrom] = useState<Dayjs | null>(null);
  const [customTo, setCustomTo] = useState<Dayjs | null>(null);

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [protocols, setProtocols] = useState<ProtoStats[]>([]);
  const [userAgents, setUserAgents] = useState<UAStats[]>([]);
  const [blocked, setBlocked] = useState<BlockedPage | null>(null);
  const [wafStats, setWafStats] = useState<WafStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  /** How many seconds the current selection spans — used for chart axis labels */
  const rangeSeconds = useMemo(() => {
    if (interval === 'custom' && customFrom && customTo) {
      const diff = customTo.unix() - customFrom.unix();
      return diff > 0 ? diff : 3600;
    }
    return INTERVAL_SECONDS_CLIENT[interval as Interval] ?? 3600;
  }, [interval, customFrom, customTo]);

  /** Build the query string for all analytics endpoints */
  const buildParams = useCallback((extra = '') => {
    const h = selectedHosts.length > 0
      ? `hosts=${selectedHosts.map(encodeURIComponent).join(',')}`
      : '';
    const sep = h ? `&${h}` : '';
    if (interval === 'custom' && customFrom && customTo) {
      return `?from=${customFrom.unix()}&to=${customTo.unix()}${sep}${extra}`;
    }
    return `?interval=${interval}${sep}${extra}`;
  }, [interval, selectedHosts, customFrom, customTo]);

  // Fetch all configured+active hosts once
  useEffect(() => {
    fetch('/api/analytics/hosts').then(r => r.json()).then(setAllHosts).catch(() => {});
  }, []);

  // Fetch all analytics data when range/host selection changes
  useEffect(() => {
    if (interval === 'custom') {
      if (!customFrom || !customTo || customFrom.unix() >= customTo.unix()) return;
    }
    setLoading(true);
    const params = buildParams();
    Promise.all([
      fetch(`/api/analytics/summary${params}`).then(r => r.json()),
      fetch(`/api/analytics/timeline${params}`).then(r => r.json()),
      fetch(`/api/analytics/countries${params}`).then(r => r.json()),
      fetch(`/api/analytics/protocols${params}`).then(r => r.json()),
      fetch(`/api/analytics/user-agents${params}`).then(r => r.json()),
      fetch(`/api/analytics/blocked${params}&page=1`).then(r => r.json()),
      fetch(`/api/analytics/waf-stats${params}`).then(r => r.json()),
    ]).then(([s, t, c, p, u, b, w]) => {
      setSummary(s);
      setTimeline(t);
      setCountries(c);
      setProtocols(p);
      setUserAgents(u);
      setBlocked(b);
      setWafStats(w);
    }).catch(() => {
      toast.error('Failed to load analytics data');
    }).finally(() => setLoading(false));
  }, [buildParams, interval, customFrom, customTo]);

  const fetchBlockedPage = useCallback((page: number) => {
    fetch(`/api/analytics/blocked${buildParams(`&page=${page}`)}`).then(r => r.json()).then(setBlocked).catch(() => {});
  }, [buildParams]);

  // ── Chart configs ─────────────────────────────────────────────────────────

  const timelineLabels = timeline.map(b => formatTs(b.ts, rangeSeconds));
  const timelineOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: 'area', stacked: true, id: 'timeline' },
    colors: ['#3b82f6', '#ef4444'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
    stroke: { curve: 'smooth', width: 2 },
    dataLabels: { enabled: false },
    xaxis: { categories: timelineLabels, labels: { rotate: 0, style: { colors: '#94a3b8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: '#94a3b8' } } },
    legend: { labels: { colors: '#94a3b8' } },
    tooltip: { theme: 'dark', shared: true, intersect: false },
  };
  const timelineSeries = [
    { name: 'Allowed', data: timeline.map(b => b.total - b.blocked) },
    { name: 'Blocked', data: timeline.map(b => b.blocked) },
  ];

  const donutOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: 'donut', id: 'protocols' },
    colors: ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b'],
    labels: protocols.map(p => p.proto),
    legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
    dataLabels: { style: { colors: ['#fff'] } },
    plotOptions: { pie: { donut: { size: '65%' } } },
  };
  const donutSeries = protocols.map(p => p.count);

  const uaNames = userAgents.map(u => parseUA(u.userAgent));
  const barOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: 'bar', id: 'ua' },
    colors: ['#7f5bff'],
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    dataLabels: { enabled: false },
    xaxis: { categories: uaNames, labels: { style: { colors: '#94a3b8', fontSize: '12px' } } },
    yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '12px' } } },
  };
  const barSeries = [{ name: 'Requests', data: userAgents.map(u => u.count) }];

  const wafRuleLabels = (wafStats?.topRules ?? []).map(r => `#${r.ruleId}`);
  const wafBarOptions: ApexOptions = {
    ...DARK_CHART,
    chart: { ...DARK_CHART.chart, type: 'bar', id: 'waf-rules' },
    colors: ['#f59e0b'],
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    dataLabels: { enabled: false },
    xaxis: { categories: wafRuleLabels, labels: { style: { colors: '#94a3b8', fontSize: '12px' } } },
    yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '12px' } } },
  };
  const wafBarSeries = [{ name: 'Hits', data: (wafStats?.topRules ?? []).map(r => r.count) }];

  const wafByCountry = new Map((wafStats?.byCountry ?? []).map(r => [r.countryCode, r.count]));

  const INTERVALS: DisplayInterval[] = ['1h', '12h', '24h', '7d', '30d', 'custom'];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-8 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Traffic Intelligence</p>
          <h1 className="text-xl font-bold tracking-tight">Analytics</h1>
        </div>
        <div className="flex flex-row items-center gap-3 flex-wrap">
          {/* Interval toggle group */}
          <div className="flex items-center rounded-md border border-input p-0.5 gap-0.5">
            {INTERVALS.map(iv => (
              <Button
                key={iv}
                size="sm"
                variant={interval === iv ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  if (iv === 'custom' && !customFrom) {
                    setCustomFrom(dayjs().subtract(24, 'hour'));
                    setCustomTo(dayjs());
                  }
                  setIntervalVal(iv);
                }}
              >
                {iv === 'custom' ? 'Custom' : iv}
              </Button>
            ))}
          </div>

          {interval === 'custom' && (
            <div className="flex items-center gap-1.5">
              <DateTimePicker value={customFrom} onChange={setCustomFrom} placeholder="From" />
              <span className="text-xs text-muted-foreground">–</span>
              <DateTimePicker value={customTo} onChange={setCustomTo} placeholder="To" />
            </div>
          )}

          <HostsCombobox
            allHosts={allHosts}
            selectedHosts={selectedHosts}
            onChange={setSelectedHosts}
          />
        </div>
      </div>

      {/* Logging disabled alert */}
      {summary?.loggingDisabled && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          Caddy access logging is not enabled — no traffic data is being collected.{' '}
          <Link href="/settings" className="underline underline-offset-2">Enable logging in Settings</Link>.
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="flex justify-center py-12">
          <span className="inline-block w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard label="Total Requests" value={summary.totalRequests.toLocaleString()} />
            <StatCard label="Unique IPs" value={summary.uniqueIps.toLocaleString()} />
            <StatCard
              label="Blocked Requests"
              value={summary.blockedRequests.toLocaleString()}
              sub={(wafStats?.total ?? 0) > 0 ? `${wafStats!.total.toLocaleString()} from WAF` : undefined}
              color={summary.blockedRequests > 0 ? '#ef4444' : undefined}
            />
            <StatCard
              label="Block Rate"
              value={`${summary.blockedPercent}%`}
              sub={`${formatBytes(summary.bytesServed)} served`}
              color={summary.blockedPercent > 10 ? '#f59e0b' : undefined}
            />
            <StatCard
              label="WAF Events"
              value={(wafStats?.total ?? 0).toLocaleString()}
              sub={wafStats && wafStats.topRules.length > 0 ? `${wafStats.topRules.length} rules triggered` : 'No WAF events'}
              color={(wafStats?.total ?? 0) > 0 ? '#f59e0b' : undefined}
            />
          </div>

          {/* Timeline */}
          <div className="rounded-lg border border-white/[0.12] p-5">
            <p className="text-sm font-semibold mb-4">Requests Over Time</p>
            {timeline.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No data for this period</div>
            ) : (
              <div className="overflow-x-auto w-full">
                <ReactApexChart
                  type="area"
                  series={timelineSeries}
                  options={timelineOptions}
                  height={220}
                />
              </div>
            )}
          </div>

          {/* World map + Countries */}
          <div className="grid grid-cols-1 md:grid-cols-[7fr_5fr] gap-3">
            <div className="rounded-lg border border-white/[0.12] flex flex-col p-5">
              <p className="text-sm font-semibold mb-2">Traffic by Country</p>
              <div className="flex-1 min-h-[280px]">
                <WorldMap data={countries} selectedCountry={selectedCountry} />
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.12] p-4">
              <p className="text-sm font-semibold mb-3">Top Countries</p>
              {countries.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">No geo data available</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-muted-foreground">Country</TableHead>
                      <TableHead className="text-muted-foreground text-right">Requests</TableHead>
                      <TableHead className="text-muted-foreground text-right">WAF</TableHead>
                      <TableHead className="text-muted-foreground text-right">Blocked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {countries.slice(0, 10).map(c => {
                      const wafCount = wafByCountry.get(c.countryCode) ?? 0;
                      return (
                        <TableRow
                          key={c.countryCode}
                          onClick={() => setSelectedCountry(s => s === c.countryCode ? null : c.countryCode)}
                          className={cn(
                            'cursor-pointer',
                            selectedCountry === c.countryCode ? 'bg-sky-300/[0.08]' : 'hover:bg-sky-300/[0.05]',
                          )}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{countryFlag(c.countryCode)}</span>
                              <span className="text-sm">{c.countryCode}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{c.total.toLocaleString()}</TableCell>
                          <TableCell className={cn('text-right text-sm', wafCount > 0 ? 'text-yellow-400' : 'text-muted-foreground')}>
                            {wafCount > 0 ? wafCount.toLocaleString() : '—'}
                          </TableCell>
                          <TableCell className={cn('text-right text-sm', c.blocked > 0 ? 'text-red-400' : 'text-muted-foreground')}>
                            {c.blocked.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          {/* Protocols + User Agents */}
          <div className="grid grid-cols-1 md:grid-cols-[5fr_7fr] gap-3">
            <div className="rounded-lg border border-white/[0.12] p-5">
              <p className="text-sm font-semibold mb-4">HTTP Protocols</p>
              {protocols.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">No data</div>
              ) : (
                <>
                  <div className="overflow-x-auto w-full">
                    <ReactApexChart type="donut" series={donutSeries} options={donutOptions} height={220} />
                  </div>
                  <Table className="mt-2">
                    <TableBody>
                      {protocols.map(p => (
                        <TableRow key={p.proto}>
                          <TableCell className="text-sm">{p.proto}</TableCell>
                          <TableCell className="text-right text-sm">{p.count.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{p.percent}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
            <div className="rounded-lg border border-white/[0.12] p-5">
              <p className="text-sm font-semibold mb-4">Top User Agents</p>
              {userAgents.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">No data</div>
              ) : (
                <div className="overflow-x-auto w-full">
                  <ReactApexChart type="bar" series={barSeries} options={barOptions} height={260} />
                </div>
              )}
            </div>
          </div>

          {/* Recent Blocked Requests */}
          <div className="rounded-lg border border-white/[0.12] p-5">
            <p className="text-sm font-semibold mb-4">Recent Blocked Requests</p>
            {!blocked || blocked.events.length === 0 ? (
              <div className="rounded-lg bg-black/30 py-10 text-center text-sm text-muted-foreground">
                No blocked requests in this period
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {['Time', 'IP', 'Country', 'Host', 'Method', 'URI', 'Status'].map(h => (
                          <TableHead key={h} className="text-muted-foreground whitespace-nowrap">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blocked.events.map(ev => (
                        <TableRow key={ev.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {new Date(ev.ts * 1000).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{ev.clientIp}</TableCell>
                          <TableCell className="text-sm">
                            {ev.countryCode ? `${countryFlag(ev.countryCode)} ${ev.countryCode}` : '—'}
                          </TableCell>
                          <TableCell className="max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap text-sm">
                            {ev.host || '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{ev.method}</TableCell>
                          <TableCell className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">
                            <span className="font-mono text-sm" title={ev.uri}>{ev.uri}</span>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-red-400">{ev.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {blocked.pages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blocked.page <= 1}
                      onClick={() => fetchBlockedPage(blocked.page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {blocked.page} of {blocked.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blocked.page >= blocked.pages}
                      onClick={() => fetchBlockedPage(blocked.page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* WAF Top Rules */}
          {wafStats && wafStats.total > 0 && (
            <div className="rounded-lg border border-white/[0.12] p-5">
              <p className="text-sm font-semibold mb-4">Top WAF Rules Triggered</p>
              <div className="overflow-x-auto w-full">
                <ReactApexChart type="bar" series={wafBarSeries} options={wafBarOptions} height={Math.max(120, wafStats.topRules.length * 32)} />
              </div>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    {['Rule', 'Description', 'Hits', 'Triggered by'].map(h => (
                      <TableHead key={h} className="text-muted-foreground whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wafStats.topRules.map(rule => (
                    <TableRow key={rule.ruleId}>
                      <TableCell className="font-mono text-sm text-yellow-400">#{rule.ruleId}</TableCell>
                      <TableCell className="max-w-[320px]">
                        {rule.message ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="text-sm text-muted-foreground truncate max-w-[300px]">{rule.message}</p>
                            </TooltipTrigger>
                            <TooltipContent>{rule.message}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{rule.count.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {rule.hosts.map(h => (
                            <Badge key={h.host} variant="secondary" className="text-xs">{h.host} ×{h.count}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
