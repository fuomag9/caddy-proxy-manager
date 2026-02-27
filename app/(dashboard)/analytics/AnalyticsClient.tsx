'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  MenuItem,
  Pagination,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { ApexOptions } from 'apexcharts';

// ── Dynamic imports (browser-only) ────────────────────────────────────────────

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

const WorldMap = dynamic(() => import('./WorldMapInner'), {
  ssr: false,
  loading: () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 240 }}>
      <CircularProgress size={24} />
    </Box>
  ),
}) as React.ComponentType<{ data: import('./WorldMapInner').CountryStats[]; selectedCountry?: string | null }>;

// ── Types (mirrored from analytics-db — can't import server-only code) ────────

type Interval = '1h' | '12h' | '24h' | '7d' | '30d';

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

function formatTs(ts: number, interval: Interval): string {
  const d = new Date(ts * 1000);
  if (interval === '1h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (interval === '12h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (interval === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (interval === '7d') return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const DARK_CHART: ApexOptions = {
  chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
  theme: { mode: 'dark' },
  grid: { borderColor: 'rgba(255,255,255,0.06)' },
  tooltip: { theme: 'dark' },
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card elevation={0} sx={{ height: '100%', border: '1px solid rgba(148,163,184,0.12)' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.03em', mt: 0.5, color: color ?? 'text.primary' }}>
          {value}
        </Typography>
        {sub && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsClient() {
  const [interval, setIntervalVal] = useState<Interval>('24h');
  const [host, setHost] = useState<string>('all');
  const [hosts, setHosts] = useState<string[]>([]);

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [protocols, setProtocols] = useState<ProtoStats[]>([]);
  const [userAgents, setUserAgents] = useState<UAStats[]>([]);
  const [blocked, setBlocked] = useState<BlockedPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  // Fetch hosts once
  useEffect(() => {
    fetch('/api/analytics/hosts').then(r => r.json()).then(setHosts).catch(() => {});
  }, []);

  // Fetch all analytics data when interval or host changes
  useEffect(() => {
    setLoading(true);
    const params = `?interval=${interval}&host=${encodeURIComponent(host)}`;
    Promise.all([
      fetch(`/api/analytics/summary${params}`).then(r => r.json()),
      fetch(`/api/analytics/timeline${params}`).then(r => r.json()),
      fetch(`/api/analytics/countries${params}`).then(r => r.json()),
      fetch(`/api/analytics/protocols${params}`).then(r => r.json()),
      fetch(`/api/analytics/user-agents${params}`).then(r => r.json()),
      fetch(`/api/analytics/blocked${params}&page=1`).then(r => r.json()),
    ]).then(([s, t, c, p, u, b]) => {
      setSummary(s);
      setTimeline(t);
      setCountries(c);
      setProtocols(p);
      setUserAgents(u);
      setBlocked(b);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [interval, host]);

  const fetchBlockedPage = useCallback((page: number) => {
    const params = `?interval=${interval}&host=${encodeURIComponent(host)}&page=${page}`;
    fetch(`/api/analytics/blocked${params}`).then(r => r.json()).then(setBlocked).catch(() => {});
  }, [interval, host]);

  // ── Chart configs ─────────────────────────────────────────────────────────

  const timelineLabels = timeline.map(b => formatTs(b.ts, interval));
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Stack spacing={4}>
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="overline" sx={{ color: 'rgba(148,163,184,0.6)', letterSpacing: 4 }}>
            Traffic Intelligence
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Analytics
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <ToggleButtonGroup
            value={interval}
            exclusive
            size="small"
            onChange={(_e, v) => { if (v) setIntervalVal(v); }}
          >
            <ToggleButton value="1h">1h</ToggleButton>
            <ToggleButton value="12h">12h</ToggleButton>
            <ToggleButton value="24h">24h</ToggleButton>
            <ToggleButton value="7d">7d</ToggleButton>
            <ToggleButton value="30d">30d</ToggleButton>
          </ToggleButtonGroup>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select
              value={host}
              onChange={(e: SelectChangeEvent) => setHost(e.target.value)}
              displayEmpty
            >
              <MenuItem value="all">All hosts</MenuItem>
              {hosts.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Stack>

      {/* Logging disabled alert */}
      {summary?.loggingDisabled && (
        <Alert severity="warning">
          Caddy access logging is not enabled — no traffic data is being collected.{' '}
          <Link href="/settings" style={{ color: 'inherit' }}>Enable logging in Settings</Link>.
        </Alert>
      )}

      {/* Loading overlay */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && summary && (
        <>
          {/* Stats row */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard label="Total Requests" value={summary.totalRequests.toLocaleString()} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard label="Unique IPs" value={summary.uniqueIps.toLocaleString()} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Blocked Requests"
                value={summary.blockedRequests.toLocaleString()}
                color={summary.blockedRequests > 0 ? '#ef4444' : undefined}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Block Rate"
                value={`${summary.blockedPercent}%`}
                sub={`${formatBytes(summary.bytesServed)} served`}
                color={summary.blockedPercent > 10 ? '#f59e0b' : undefined}
              />
            </Grid>
          </Grid>

          {/* Timeline */}
          <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Requests Over Time
              </Typography>
              {timeline.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>No data for this period</Box>
              ) : (
                <ReactApexChart
                  type="area"
                  series={timelineSeries}
                  options={timelineOptions}
                  height={220}
                />
              )}
            </CardContent>
          </Card>

          {/* World map + Countries */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                    Traffic by Country
                  </Typography>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <WorldMap data={countries} selectedCountry={selectedCountry} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)', height: '100%' }}>
                <CardContent sx={{ p: '16px !important' }}>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
                    Top Countries
                  </Typography>
                  {countries.length === 0 ? (
                    <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No geo data available</Box>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ color: 'text.secondary', borderColor: 'rgba(255,255,255,0.06)' }}>Country</TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary', borderColor: 'rgba(255,255,255,0.06)' }}>Requests</TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary', borderColor: 'rgba(255,255,255,0.06)' }}>Blocked</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {countries.slice(0, 10).map(c => (
                          <TableRow
                            key={c.countryCode}
                            onClick={() => setSelectedCountry(s => s === c.countryCode ? null : c.countryCode)}
                            sx={{
                              cursor: 'pointer',
                              '& td': { borderColor: 'rgba(255,255,255,0.04)' },
                              bgcolor: selectedCountry === c.countryCode ? 'rgba(125,211,252,0.08)' : 'transparent',
                              '&:hover': { bgcolor: 'rgba(125,211,252,0.05)' },
                            }}
                          >
                            <TableCell>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <span>{countryFlag(c.countryCode)}</span>
                                <Typography variant="body2">{c.countryCode}</Typography>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2">{c.total.toLocaleString()}</Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color={c.blocked > 0 ? 'error.light' : 'text.secondary'}>
                                {c.blocked.toLocaleString()}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Protocols + User Agents */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)', height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                    HTTP Protocols
                  </Typography>
                  {protocols.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>No data</Box>
                  ) : (
                    <>
                      <ReactApexChart type="donut" series={donutSeries} options={donutOptions} height={220} />
                      <Table size="small" sx={{ mt: 1 }}>
                        <TableBody>
                          {protocols.map(p => (
                            <TableRow key={p.proto} sx={{ '& td': { borderColor: 'rgba(255,255,255,0.04)' } }}>
                              <TableCell><Typography variant="body2">{p.proto}</Typography></TableCell>
                              <TableCell align="right"><Typography variant="body2">{p.count.toLocaleString()}</Typography></TableCell>
                              <TableCell align="right"><Typography variant="body2" color="text.secondary">{p.percent}%</Typography></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)', height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                    Top User Agents
                  </Typography>
                  {userAgents.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>No data</Box>
                  ) : (
                    <ReactApexChart type="bar" series={barSeries} options={barOptions} height={260} />
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Recent Blocked Requests */}
          <Card elevation={0} sx={{ border: '1px solid rgba(148,163,184,0.12)' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Recent Blocked Requests
              </Typography>
              {!blocked || blocked.events.length === 0 ? (
                <Paper elevation={0} sx={{ py: 5, textAlign: 'center', color: 'text.secondary', bgcolor: 'rgba(12,18,30,0.5)' }}>
                  No blocked requests in this period
                </Paper>
              ) : (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Time', 'IP', 'Country', 'Host', 'Method', 'URI', 'Status'].map(h => (
                          <TableCell key={h} sx={{ color: 'text.secondary', borderColor: 'rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {blocked.events.map(ev => (
                        <TableRow key={ev.id} sx={{ '& td': { borderColor: 'rgba(255,255,255,0.04)' } }}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Typography variant="body2" color="text.secondary">
                              {new Date(ev.ts * 1000).toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell><Typography variant="body2" fontFamily="monospace">{ev.clientIp}</Typography></TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {ev.countryCode ? `${countryFlag(ev.countryCode)} ${ev.countryCode}` : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Typography variant="body2">{ev.host || '—'}</Typography>
                          </TableCell>
                          <TableCell><Typography variant="body2" fontFamily="monospace">{ev.method}</Typography></TableCell>
                          <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Typography variant="body2" fontFamily="monospace" title={ev.uri}>{ev.uri}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="error.light" fontFamily="monospace">{ev.status}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {blocked.pages > 1 && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                      <Pagination
                        count={blocked.pages}
                        page={blocked.page}
                        onChange={(_e, p) => fetchBlockedPage(p)}
                        color="primary"
                        size="small"
                      />
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}
