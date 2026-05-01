"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Search, X, ShieldOff, Trash2, Copy, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DataTable } from "@/components/ui/DataTable";
import type { WafEvent } from "@/lib/models/waf-events";
import type { WafSettings } from "@/lib/settings";
import {
  suppressWafRuleGloballyAction,
  suppressWafRuleForHostAction,
  removeWafRuleGloballyAction,
  lookupWafRuleMessageAction,
  updateWafSettingsAction,
} from "../settings/actions";

type Props = {
  events: WafEvent[];
  pagination: { total: number; page: number; perPage: number };
  initialSearch: string;
  globalExcluded: number[];
  globalExcludedMessages: Record<number, string | null>;
  globalWafEnabled: boolean;
  hostWafMap: Record<string, number[]>;
  globalWaf: WafSettings | null;
};

/* ── Audit data types ─────────────────────────────────────────────────────── */
interface AuditRequest {
  method?: string;
  protocol?: string;
  uri?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  args?: Record<string, string | string[]>;
  length?: number;
}
interface AuditResponse {
  protocol?: string;
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string;
}
interface AuditTransaction {
  timestamp?: string;
  id?: string;
  client_ip?: string;
  client_port?: number;
  host_port?: number;
  server_id?: string;
  request?: AuditRequest;
  response?: AuditResponse;
}
interface AuditMessageDetails {
  match?: string;
  reference?: string;
  ruleId?: number;
  file?: string;
  lineNumber?: string;
  tags?: string[];
  logdata?: string;
  severity?: string;
  msg?: string;
}
interface AuditMessage {
  message?: string;
  details?: AuditMessageDetails;
}
interface AuditData {
  transaction?: AuditTransaction;
  messages?: AuditMessage[];
}

/* ── Severity config ──────────────────────────────────────────────────────── */
const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL: "border-red-500 text-red-500",
  ERROR:    "border-red-500 text-red-500",
  HIGH:     "border-red-500 text-red-500",
  WARNING:  "border-yellow-500 text-yellow-500",
  NOTICE:   "border-blue-500 text-blue-500",
  INFO:     "border-blue-500 text-blue-500",
};

/* ── Chips ───────────────────────────────────────────────────────────────── */
function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-muted-foreground text-xs">—</span>;
  const upper = severity.toUpperCase();
  const classes = SEVERITY_CLASSES[upper] ?? "border-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("text-[0.7rem] font-semibold px-1.5 py-0 h-[18px]", classes)}>
      {upper}
    </Badge>
  );
}

function BlockedChip({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <Badge className="text-[0.7rem] font-semibold px-1.5 py-0 h-[18px] bg-destructive hover:bg-destructive/90">Blocked</Badge>
  ) : (
    <Badge variant="outline" className="text-[0.7rem] font-semibold px-1.5 py-0 h-[18px] border-yellow-500/60 text-yellow-500">
      Detected
    </Badge>
  );
}

/* ── Detail field row ─────────────────────────────────────────────────────── */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/* ── Stats bar ────────────────────────────────────────────────────────────── */
function StatsBar({ events }: { events: WafEvent[] }) {
  const blocked  = events.filter(e => e.blocked).length;
  const critical = events.filter(e => e.severity?.toUpperCase() === "CRITICAL").length;
  const hosts    = new Set(events.map(e => e.host)).size;
  const rules    = new Set(events.map(e => e.ruleId).filter(Boolean)).size;

  const stats = [
    { label: "Total Events",       value: events.length, color: "" },
    { label: "Blocked",            value: blocked,        color: "text-destructive" },
    { label: "Critical",           value: critical,       color: "text-yellow-500" },
    { label: "Unique Hosts",       value: hosts,          color: "text-primary" },
    { label: "Rule IDs Triggered", value: rules,          color: "text-blue-500" },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border bg-card px-4 py-3 flex flex-col gap-0.5">
          <span className={cn("text-2xl font-bold leading-none", color || "text-foreground")}>{value}</span>
          <span className="text-[0.7rem] text-muted-foreground font-medium">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Audit panel ─────────────────────────────────────────────────────────── */
function HeadersGrid({ headers }: { headers?: Record<string, string | string[]> }) {
  if (!headers || Object.keys(headers).length === 0)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="grid gap-x-3 gap-y-0.5 font-mono text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
      {Object.entries(headers).map(([k, v]) => [
        <span key={k + "-k"} className="text-muted-foreground whitespace-nowrap">{k}</span>,
        <span key={k + "-v"} className="break-all">{Array.isArray(v) ? v.join(", ") : v}</span>,
      ])}
    </div>
  );
}

function AuditPanel({ rawData }: { rawData: string | null }) {
  const [innerTab, setInnerTab] = useState("overview");
  const [showRaw, setShowRaw] = useState(false);

  let data: AuditData | null = null;
  if (rawData) {
    try { data = JSON.parse(rawData) as AuditData; } catch { /* leave null */ }
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-muted/40 px-4 py-5 text-sm text-muted-foreground text-center">
        No audit data available for this event.
      </div>
    );
  }

  const tx   = data.transaction ?? null;
  const req  = tx?.request ?? null;
  const res  = tx?.response ?? null;
  const msgs = data.messages ?? [];

  const INNER_TABS = [
    { id: "overview",  label: "Overview" },
    { id: "request",   label: "Request"  },
    { id: "response",  label: "Response" },
    ...(msgs.length ? [{ id: "matches", label: `Matches (${msgs.length})` }] : []),
  ];

  const tabCls = (id: string) => cn(
    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
    innerTab === id
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:text-foreground"
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Inner tab bar */}
      <div className="flex gap-1 p-0.5 rounded-lg border bg-background self-start">
        {INNER_TABS.map(t => (
          <button key={t.id} className={tabCls(t.id)} onClick={() => setInnerTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-lg border bg-muted/40 p-4 flex flex-col gap-3">
        {/* ── Overview ── */}
        {innerTab === "overview" && tx && (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DetailRow label="Transaction ID">
                <span className="font-mono text-xs">{tx.id ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Timestamp">
                <span className="text-sm">{tx.timestamp ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Client">
                <span className="font-mono text-xs">{tx.client_ip ?? "—"}:{tx.client_port ?? 0}</span>
              </DetailRow>
              <DetailRow label="Server">
                <span className="font-mono text-xs">{tx.server_id ?? "—"}:{tx.host_port ?? 0}</span>
              </DetailRow>
            </div>
            {msgs.length > 0 && (
              <div className="pt-3 border-t flex flex-col gap-2">
                <p className="text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">Matched Rules</p>
                {msgs.map((m, i) => (
                  <div key={i} className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-destructive font-semibold">Rule {m.details?.ruleId ?? "—"}</span>
                      <SeverityChip severity={m.details?.severity ?? null} />
                    </div>
                    <span className="text-xs">{m.message}</span>
                    {m.details?.match && (
                      <span className="font-mono text-[0.7rem] text-muted-foreground break-all">↳ {m.details.match}</span>
                    )}
                    {(m.details?.tags?.length ?? 0) > 0 && (
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {m.details!.tags!.map(t => (
                          <span key={t} className="text-[0.62rem] px-1.5 py-px rounded-full bg-muted text-muted-foreground">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Request ── */}
        {innerTab === "request" && req && (
          <div className="flex flex-col gap-3">
            <div className="font-mono text-xs rounded bg-background border px-3 py-2 flex gap-2 items-baseline flex-wrap">
              <span className="text-primary font-semibold">{req.method}</span>
              <span className="break-all">{req.uri}</span>
              <span className="text-muted-foreground ml-auto shrink-0">{req.protocol}</span>
            </div>
            <DetailRow label="Headers"><HeadersGrid headers={req.headers} /></DetailRow>
            {req.args && Object.keys(req.args).length > 0 && (
              <DetailRow label="Query Args"><HeadersGrid headers={req.args as Record<string, string>} /></DetailRow>
            )}
            {req.body && (
              <DetailRow label="Body">
                <pre className="font-mono text-[0.7rem] text-muted-foreground bg-background border rounded px-3 py-2 whitespace-pre-wrap break-all overflow-x-auto">
                  {(() => { try { return JSON.stringify(JSON.parse(req.body), null, 2); } catch { return req.body; } })()}
                </pre>
              </DetailRow>
            )}
            <DetailRow label="Content Length">
              <span className="font-mono text-xs">{req.length ?? 0} bytes</span>
            </DetailRow>
          </div>
        )}

        {/* ── Response ── */}
        {innerTab === "response" && res && (
          <div className="flex flex-col gap-3">
            <div className="font-mono text-xs rounded bg-background border px-3 py-2 flex gap-2 items-center">
              <span className={cn("font-bold text-sm", (res.status ?? 0) >= 400 ? "text-destructive" : (res.status ?? 0) >= 300 ? "text-yellow-500" : "text-green-500")}>
                {res.status || "—"}
              </span>
              <span className="text-muted-foreground">{res.protocol}</span>
            </div>
            <DetailRow label="Response Headers"><HeadersGrid headers={res.headers} /></DetailRow>
            {res.body && (
              <DetailRow label="Body">
                <pre className="font-mono text-[0.7rem] text-muted-foreground bg-background border rounded px-3 py-2 whitespace-pre-wrap break-all overflow-x-auto">
                  {res.body}
                </pre>
              </DetailRow>
            )}
          </div>
        )}

        {/* ── Matches ── */}
        {innerTab === "matches" && (
          <div className="flex flex-col gap-4">
            {msgs.map((m, i) => (
              <div key={i} className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <DetailRow label="Rule ID">
                    <span className="font-mono text-xs text-destructive font-semibold">{m.details?.ruleId ?? "—"}</span>
                  </DetailRow>
                  <DetailRow label="Severity">
                    <SeverityChip severity={m.details?.severity ?? null} />
                  </DetailRow>
                  <DetailRow label="Message">
                    <span className="text-xs">{m.message}</span>
                  </DetailRow>
                  <DetailRow label="Log Data">
                    <span className="font-mono text-[0.7rem] break-all">{m.details?.logdata ?? "—"}</span>
                  </DetailRow>
                  <DetailRow label="File">
                    <span className="font-mono text-[0.68rem] text-muted-foreground break-all">
                      {m.details?.file ?? "—"}:{m.details?.lineNumber ?? ""}
                    </span>
                  </DetailRow>
                  <DetailRow label="Reference">
                    <span className="font-mono text-[0.7rem] text-muted-foreground">{m.details?.reference ?? "—"}</span>
                  </DetailRow>
                </div>
                {(m.details?.tags?.length ?? 0) > 0 && (
                  <DetailRow label="Tags">
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {m.details!.tags!.map(t => (
                        <span key={t} className="text-[0.65rem] px-1.5 py-px rounded-full border bg-muted text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </DetailRow>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible raw JSON */}
      <div className="rounded-lg border overflow-hidden">
        <button
          onClick={() => setShowRaw(r => !r)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 text-muted-foreground text-xs font-medium hover:bg-muted/70 transition-colors"
        >
          <span>Raw JSON</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", showRaw && "rotate-180")} />
        </button>
        {showRaw && (
          <pre className="px-3 py-3 bg-background font-mono text-[0.72rem] max-h-80 overflow-auto text-muted-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Event detail panel (inline) ─────────────────────────────────────────── */
function EventDetailPanel({
  event,
  onClose,
  globalExcluded,
  hostWafMap,
  onSuppressGlobal,
  onSuppressHost,
}: {
  event: WafEvent;
  onClose: () => void;
  globalExcluded: number[];
  hostWafMap: Record<string, number[]>;
  onSuppressGlobal: (ruleId: number) => void;
  onSuppressHost: (ruleId: number, host: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  const isGloballySuppressed  = event.ruleId != null && globalExcluded.includes(event.ruleId);
  const isHostOnlySuppressed  = event.ruleId != null && !!event.host && (hostWafMap[event.host] ?? []).includes(event.ruleId);
  const isHostSuppressed      = isGloballySuppressed || isHostOnlySuppressed;

  function handleSuppressGlobally() {
    if (!event.ruleId) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(event.ruleId!);
      if (result.success) { toast.success(result.message ?? "Done"); onSuppressGlobal(event.ruleId!); }
      else toast.error(result.message ?? "Failed");
    });
  }

  function handleSuppressForHost() {
    if (!event.ruleId || !event.host) return;
    startTransition(async () => {
      const result = await suppressWafRuleForHostAction(event.ruleId!, event.host!);
      if (result.success) { toast.success(result.message ?? "Done"); onSuppressHost(event.ruleId!, event.host!); }
      else toast.error(result.message ?? "Failed");
    });
  }

  return (
    <div className="sticky top-6 shrink-0 rounded-xl border border-border bg-card flex flex-col overflow-hidden" style={{ width: 480, maxHeight: "calc(100vh - 3rem)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <BlockedChip blocked={event.blocked} />
        <SeverityChip severity={event.severity} />
        <h2 className="text-sm font-semibold ml-1">WAF Event</h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="ml-auto h-7 w-7">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-4">
          <DetailRow label="Time">
            <p className="text-sm">{new Date(event.ts * 1000).toLocaleString()}</p>
          </DetailRow>
          <DetailRow label="Host">
            <p className="font-mono text-sm break-all">{event.host || "—"}</p>
          </DetailRow>
          <DetailRow label="Client IP">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-sm">{event.clientIp}</span>
              {event.countryCode && (
                <Badge variant="outline" className="text-[0.65rem] h-[18px] px-1">{event.countryCode}</Badge>
              )}
            </div>
          </DetailRow>
          <DetailRow label="Method">
            <span className="font-mono text-sm font-semibold text-primary">{event.method}</span>
          </DetailRow>
          <div className="col-span-2">
            <DetailRow label="URI">
              <p className="font-mono text-xs break-all text-muted-foreground">{event.uri || "—"}</p>
            </DetailRow>
          </div>
          <DetailRow label="Rule ID">
            <span className="font-mono text-sm text-destructive font-semibold">{event.ruleId ?? "—"}</span>
          </DetailRow>
          <div className="col-span-2">
            <DetailRow label="Rule Message">
              <p className="text-sm break-words leading-snug">{event.ruleMessage ?? "—"}</p>
            </DetailRow>
          </div>
        </div>

        {/* Suppress actions */}
        {event.ruleId != null && (
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="text-[0.72rem] text-destructive border-destructive/40 hover:bg-destructive/10 h-7 gap-1.5"
              onClick={handleSuppressGlobally}
              disabled={pending || isGloballySuppressed}
            >
              <ShieldOff className="h-3 w-3" />
              {isGloballySuppressed ? "Suppressed Globally" : "Suppress Globally"}
            </Button>
            {event.host && (
              <Button
                size="sm"
                variant="outline"
                className="text-[0.72rem] text-yellow-500 border-yellow-500/40 hover:bg-yellow-500/10 h-7 gap-1.5"
                onClick={handleSuppressForHost}
                disabled={pending || isHostSuppressed}
              >
                <ShieldOff className="h-3 w-3" />
                {isHostSuppressed ? `Suppressed for ${event.host}` : `Suppress for ${event.host}`}
              </Button>
            )}
          </div>
        )}

        <Separator />

        {/* Audit data */}
        <div>
          <p className="text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground mb-2">Audit Data</p>
          <AuditPanel rawData={event.rawData} />
        </div>
      </div>
    </div>
  );
}

/* ── Global suppressed rules tab ─────────────────────────────────────────── */
function GlobalSuppressedRules({
  excluded,
  messages: initialMessages,
  wafEnabled,
  onRemove,
  onAdd,
}: {
  excluded: number[];
  messages: Record<number, string | null>;
  wafEnabled: boolean;
  onRemove: (ruleId: number) => void;
  onAdd: (ruleId: number, message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState(initialMessages);

  const [addInput, setAddInput] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [pendingRule, setPendingRule] = useState<{ id: number; message: string | null } | null>(null);
  const [search, setSearch] = useState("");

  function handleRemove(ruleId: number) {
    startTransition(async () => {
      const result = await removeWafRuleGloballyAction(ruleId);
      if (result.success) { toast.success(result.message ?? "Done"); onRemove(ruleId); }
      else toast.error(result.message ?? "Failed");
    });
  }

  async function handleLookup() {
    const n = parseInt(addInput.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (excluded.includes(n)) { toast.error(`Rule ${n} is already suppressed.`); return; }
    setLookupPending(true);
    try {
      const result = await lookupWafRuleMessageAction(n);
      setPendingRule({ id: n, message: result.message });
    } finally {
      setLookupPending(false);
    }
  }

  function handleConfirmAdd() {
    if (!pendingRule) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(pendingRule.id);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onAdd(pendingRule.id, pendingRule.message);
        setMessages((prev) => ({ ...prev, [pendingRule.id]: pendingRule.message }));
        setAddInput("");
        setPendingRule(null);
      } else {
        toast.error(result.message ?? "Failed");
      }
    });
  }

  const filtered = excluded.filter((id) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return String(id).includes(q) || (messages[id] ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Global WAF Rule Exclusions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Rules listed here are suppressed globally via <code>SecRuleRemoveById</code> for all proxy hosts using global WAF settings.
        </p>
        {!wafEnabled && (
          <Alert className="mt-3">
            <AlertDescription>Global WAF is currently disabled. Exclusions are saved but have no effect until WAF is enabled.</AlertDescription>
          </Alert>
        )}
      </div>

      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Add Rule by ID</p>
        <div className="flex items-center gap-2 mt-1.5 max-w-xs">
          <Input
            placeholder="Rule ID"
            value={addInput}
            onChange={(e) => { setAddInput(e.target.value); setPendingRule(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleLookup(); } }}
            inputMode="numeric"
            pattern="[0-9]*"
            className="flex-1"
            disabled={lookupPending || pending}
          />
          <Button variant="outline" size="sm" onClick={handleLookup} disabled={!addInput.trim() || lookupPending || pending}>
            {lookupPending ? "Looking up…" : "Look up"}
          </Button>
        </div>
        {pendingRule && (
          <div className="mt-3 px-4 py-3 rounded-lg border border-yellow-500 bg-muted max-w-[480px]">
            <p className="text-sm font-mono font-bold text-red-400">Rule {pendingRule.id}</p>
            <p className="text-xs block mt-0.5 text-muted-foreground">
              {pendingRule.message ?? "No description available — rule has not triggered yet"}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" variant="destructive" onClick={handleConfirmAdd} disabled={pending}>
                {pending ? "Suppressing…" : "Suppress Globally"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setPendingRule(null); setAddInput(""); }} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {excluded.length > 0 && (
        <div className="relative max-w-[400px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by rule ID or message…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      )}

      {excluded.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
          <ShieldOff className="h-9 w-9 opacity-30 mb-2 mx-auto" />
          <p className="text-sm">No globally suppressed rules.</p>
          <p className="text-xs">Add a rule above or open a WAF event and click &quot;Suppress Globally&quot;.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No rules match your search.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((id) => (
            <div key={id} className="flex items-center gap-4 px-4 py-3 rounded-lg border bg-muted/50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-bold text-red-400">Rule {id}</p>
                <p className="text-xs block mt-0.5 text-muted-foreground">
                  {messages[id] ?? "No description available — rule has not triggered yet"}
                </p>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(id)} disabled={pending}
                      className="shrink-0 text-red-500 hover:text-red-600 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove suppression</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main client component ───────────────────────────────────────────────── */
export default function WafEventsClient({ events, pagination, initialSearch, globalExcluded, globalExcludedMessages, globalWafEnabled, hostWafMap, globalWaf }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab]                             = useState("events");
  const [searchTerm, setSearchTerm]               = useState(initialSearch);
  const [selected, setSelected]                   = useState<WafEvent | null>(null);
  const [localGlobalExcluded, setLocalGlobalExcluded]     = useState(globalExcluded);
  const [localGlobalMessages, setLocalGlobalMessages]     = useState(globalExcludedMessages);
  const [localHostWafMap, setLocalHostWafMap]             = useState(hostWafMap);
  const [wafState, wafFormAction]   = useActionState(updateWafSettingsAction, null);
  const [wafEnabled, setWafEnabled] = useState(globalWaf?.enabled ?? false);
  const [wafLoadOwaspCrs, setWafLoadOwaspCrs]     = useState(globalWaf?.load_owasp_crs ?? true);
  const [wafCustomDirectives, setWafCustomDirectives]     = useState(globalWaf?.custom_directives ?? "");
  const [wafShowTemplates, setWafShowTemplates]   = useState(false);

  useEffect(() => { setSearchTerm(initialSearch); }, [initialSearch]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) { params.set("search", value.trim()); } else { params.delete("search"); }
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const METHOD_COLORS: Record<string, string> = {
    GET:    "text-green-500",
    POST:   "text-primary",
    PUT:    "text-yellow-500",
    DELETE: "text-destructive",
    PATCH:  "text-yellow-500",
  };

  const mobileCard = (event: WafEvent) => (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelected(event)}>
      <CardContent className="p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BlockedChip blocked={event.blocked} />
            <SeverityChip severity={event.severity} />
          </div>
          <span className="text-xs text-muted-foreground">{new Date(event.ts * 1000).toLocaleString()}</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground break-all">{event.host || "—"}</p>
        {event.ruleId && <span className="text-xs text-muted-foreground">Rule #{event.ruleId}</span>}
      </CardContent>
    </Card>
  );

  const columns = [
    {
      id: "ts", label: "Time", width: 150,
      render: (r: WafEvent) => (
        <span className="text-muted-foreground text-[0.78rem] whitespace-nowrap font-mono">
          {new Date(r.ts * 1000).toLocaleString()}
        </span>
      ),
    },
    {
      id: "blocked", label: "Action", width: 76,
      render: (r: WafEvent) => <BlockedChip blocked={r.blocked} />,
    },
    {
      id: "severity", label: "Severity", width: 80,
      render: (r: WafEvent) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host", label: "Host", width: 130,
      render: (r: WafEvent) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[0.78rem] max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap block">
                {r.host || <span className="opacity-40">—</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.host ?? ""}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      id: "clientIp", label: "Client IP", width: 130,
      render: (r: WafEvent) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-[0.78rem] whitespace-nowrap">{r.clientIp}</span>
          {r.countryCode && (
            <Badge variant="outline" className="text-[0.62rem] h-[16px] px-1 shrink-0">{r.countryCode}</Badge>
          )}
        </div>
      ),
    },
    {
      id: "method", label: "Request", width: 200,
      render: (r: WafEvent) => (
        <div className="flex items-baseline gap-1.5 overflow-hidden font-mono min-w-0">
          <span className={cn("font-bold text-[0.7rem] shrink-0", METHOD_COLORS[r.method] ?? "text-muted-foreground")}>
            {r.method || "—"}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[0.78rem] text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                  {r.uri || "—"}
                </span>
              </TooltipTrigger>
              <TooltipContent>{r.uri}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ),
    },
    {
      id: "ruleId", label: "Rule ID", width: 70,
      render: (r: WafEvent) => (
        <span className="text-muted-foreground font-mono text-[0.78rem]">{r.ruleId ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 w-full">
      <h1 className="text-3xl font-semibold">WAF</h1>
      <p className="text-muted-foreground">Web Application Firewall events and rule management.</p>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v !== "events") setSelected(null); }}>
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="suppressed">Suppressed Rules</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          <div className={cn("flex gap-6 items-start", selected ? "flex-row" : "flex-col")}>
            {/* Left: table area */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <StatsBar events={events} />
              <div className="relative max-w-[480px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by host, IP, URI, or rule message..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); updateSearch(e.target.value); }}
                  className="pl-8"
                />
              </div>
              <DataTable
                columns={columns}
                data={events}
                keyField="id"
                emptyMessage="No WAF events found. Enable the WAF in Settings and send some traffic to see events here."
                pagination={pagination}
                onRowClick={(row) => setSelected(prev => prev?.id === row.id ? null : row)}
                rowClassName={(row) => row.id === selected?.id ? "bg-primary/5" : ""}
                mobileCard={mobileCard}
              />
            </div>

            {/* Right: inline detail panel */}
            {selected && (
              <EventDetailPanel
                event={selected}
                onClose={() => setSelected(null)}
                globalExcluded={localGlobalExcluded}
                hostWafMap={localHostWafMap}
                onSuppressGlobal={(ruleId) => setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])])}
                onSuppressHost={(ruleId, host) => setLocalHostWafMap((prev) => ({ ...prev, [host]: [...new Set([...(prev[host] ?? []), ruleId])] }))}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="suppressed">
          <GlobalSuppressedRules
            excluded={localGlobalExcluded}
            messages={localGlobalMessages}
            wafEnabled={globalWafEnabled}
            onRemove={(ruleId) => setLocalGlobalExcluded((prev) => prev.filter((id) => id !== ruleId))}
            onAdd={(ruleId, message) => {
              setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])]);
              setLocalGlobalMessages((prev) => ({ ...prev, [ruleId]: message }));
            }}
          />
        </TabsContent>

        <TabsContent value="settings">
          <div className="flex flex-col gap-6 max-w-[720px]">
            <div>
              <h2 className="text-lg font-semibold">WAF Settings</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure the global Web Application Firewall. Per-host settings can merge with or override these defaults.
                Powered by <strong>Coraza</strong> with optional OWASP Core Rule Set.
              </p>
            </div>
            <form action={wafFormAction} className="flex flex-col gap-4">
              <input type="hidden" name="wafEnabled" value={wafEnabled ? "on" : ""} />
              <input type="hidden" name="wafLoadOwaspCrs" value={wafLoadOwaspCrs ? "on" : ""} />
              {wafState?.message && (
                <Alert variant={wafState.success ? "default" : "destructive"}>
                  <AlertDescription>{wafState.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-3">
                <Switch checked={wafEnabled} onCheckedChange={setWafEnabled} id="waf_enabled" />
                <Label htmlFor="waf_enabled">Enable WAF globally (blocking)</Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox checked={wafLoadOwaspCrs} onCheckedChange={(v) => setWafLoadOwaspCrs(!!v)} id="waf_load_owasp_crs" />
                <Label htmlFor="waf_load_owasp_crs">
                  Load OWASP Core Rule Set{" "}
                  <span className="text-xs text-muted-foreground">(covers SQLi, XSS, LFI, RCE — recommended)</span>
                </Label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="waf_custom_directives">Custom SecLang Directives</Label>
                <Textarea
                  id="waf_custom_directives"
                  name="wafCustomDirectives"
                  rows={3}
                  value={wafCustomDirectives}
                  onChange={(e) => setWafCustomDirectives(e.target.value)}
                  placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
                  className="font-mono text-[0.8rem] resize-y"
                />
                <p className="text-xs text-muted-foreground">ModSecurity SecLang syntax. Applied after OWASP CRS if enabled.</p>
              </div>
              <div>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground px-0" onClick={() => setWafShowTemplates((v) => !v)}>
                  Quick Templates
                  <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform duration-200", wafShowTemplates && "rotate-180")} />
                </Button>
                <div className={cn("overflow-hidden transition-all duration-200", wafShowTemplates ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none")}>
                  <div className="flex flex-col gap-1.5 mt-2">
                    {[
                      { label: "Allow IP",             snippet: `SecRule REMOTE_ADDR "@ipMatch 1.2.3.4" "id:9000,phase:1,allow,nolog,msg:'Allow IP'"` },
                      { label: "Disable WAF for path", snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"` },
                      { label: "Remove XSS rules",     snippet: `SecRuleRemoveByTag "attack-xss"` },
                      { label: "Block User-Agent",     snippet: `SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:9002,phase:1,deny,status:403,log"` },
                    ].map((t) => (
                      <Button key={t.label} type="button" size="sm" variant="outline" className="justify-start font-mono text-[0.72rem]"
                        onClick={() => setWafCustomDirectives((prev) => prev ? `${prev}\n${t.snippet}` : t.snippet)}>
                        <Copy className="h-3 w-3 mr-1.5 shrink-0" />
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <Alert>
                <AlertDescription className="text-[0.8rem]">
                  Rule exclusions are managed on the <strong>Suppressed Rules</strong> tab.
                </AlertDescription>
              </Alert>
              <div className="flex justify-end">
                <Button type="submit">Save WAF settings</Button>
              </div>
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
