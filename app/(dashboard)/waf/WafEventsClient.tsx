"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Search, X, ShieldOff, Trash2, Copy, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL: "border-red-500 text-red-500",
  ERROR: "border-red-500 text-red-500",
  HIGH: "border-red-500 text-red-500",
  WARNING: "border-yellow-500 text-yellow-500",
  NOTICE: "border-blue-500 text-blue-500",
  INFO: "border-blue-500 text-blue-500",
};

function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-muted-foreground text-sm">—</span>;
  const upper = severity.toUpperCase();
  const classes = SEVERITY_CLASSES[upper] ?? "border-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("text-[0.7rem] font-semibold px-1.5 py-0", classes)}>
      {upper}
    </Badge>
  );
}

function BlockedChip({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <Badge className="text-[0.7rem] font-semibold bg-red-500 hover:bg-red-600 px-1.5 py-0">Blocked</Badge>
  ) : (
    <Badge variant="outline" className="text-[0.7rem] font-semibold border-yellow-500 text-yellow-500 px-1.5 py-0">
      Detected
    </Badge>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function WafEventDrawer({
  event,
  onClose,
  globalExcluded,
  hostWafMap,
  onSuppressGlobal,
  onSuppressHost,
}: {
  event: WafEvent | null;
  onClose: () => void;
  globalExcluded: number[];
  hostWafMap: Record<string, number[]>;
  onSuppressGlobal: (ruleId: number) => void;
  onSuppressHost: (ruleId: number, host: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  let parsedRaw: unknown = null;
  if (event?.rawData) {
    try { parsedRaw = JSON.parse(event.rawData); } catch { parsedRaw = event.rawData; }
  }

  const isGloballySuppressed = event?.ruleId != null && globalExcluded.includes(event.ruleId);
  const isHostOnlySuppressed = event?.ruleId != null && !!event.host && (hostWafMap[event.host] ?? []).includes(event.ruleId);
  const isHostSuppressed = isGloballySuppressed || isHostOnlySuppressed;

  function handleSuppressGlobally() {
    if (!event?.ruleId) return;
    startTransition(async () => {
      const result = await suppressWafRuleGloballyAction(event.ruleId!);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onSuppressGlobal(event.ruleId!);
      } else {
        toast.error(result.message ?? "Failed");
      }
    });
  }

  function handleSuppressForHost() {
    if (!event?.ruleId || !event?.host) return;
    startTransition(async () => {
      const result = await suppressWafRuleForHostAction(event.ruleId!, event.host!);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onSuppressHost(event.ruleId!, event.host!);
      } else {
        toast.error(result.message ?? "Failed");
      }
    });
  }

  return (
    <Sheet open={!!event} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] overflow-y-auto">
        <SheetTitle className="sr-only">WAF Event Details</SheetTitle>
        {event && (
          <div className="flex flex-col gap-5 h-full pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BlockedChip blocked={event.blocked} />
                <SeverityChip severity={event.severity} />
                <h2 className="text-lg font-semibold">WAF Event</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Separator />

            <DetailRow label="Time">
              <p className="text-sm">{new Date(event.ts * 1000).toLocaleString()}</p>
            </DetailRow>

            <DetailRow label="Host">
              <p className="text-sm font-mono break-all">{event.host || "—"}</p>
            </DetailRow>

            <DetailRow label="Client IP">
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono">{event.clientIp}</p>
                {event.countryCode && (
                  <Badge variant="outline" className="text-[0.65rem] h-[18px] px-1">
                    {event.countryCode}
                  </Badge>
                )}
              </div>
            </DetailRow>

            <DetailRow label="Request">
              <p className="text-sm font-mono break-all">{event.method} {event.uri}</p>
            </DetailRow>

            <DetailRow label="Rule ID">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-mono">{event.ruleId ?? "—"}</p>
                {event.ruleId != null && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[0.72rem] text-red-500 border-red-500 hover:bg-red-500/10 h-7"
                      onClick={handleSuppressGlobally}
                      disabled={pending || isGloballySuppressed}
                    >
                      <ShieldOff className="h-3 w-3 mr-1" />
                      {isGloballySuppressed ? "Suppressed Globally" : "Suppress Globally"}
                    </Button>
                    {event.host && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[0.72rem] text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 h-7"
                        onClick={handleSuppressForHost}
                        disabled={pending || isHostSuppressed}
                      >
                        <ShieldOff className="h-3 w-3 mr-1" />
                        {isHostSuppressed ? `Suppressed for ${event.host}` : `Suppress for ${event.host}`}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </DetailRow>

            <DetailRow label="Rule Message">
              <p className="text-sm break-words">{event.ruleMessage ?? "—"}</p>
            </DetailRow>

            <Separator />

            <DetailRow label="Raw Audit Data">
              {parsedRaw !== null ? (
                <pre className="m-0 p-3 rounded bg-muted text-[0.7rem] font-mono overflow-x-auto whitespace-pre-wrap break-all select-text">
                  {JSON.stringify(parsedRaw, null, 2)}
                </pre>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </DetailRow>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

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

  // Add-rule state
  const [addInput, setAddInput] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [pendingRule, setPendingRule] = useState<{ id: number; message: string | null } | null>(null);

  // Search
  const [search, setSearch] = useState("");

  function handleRemove(ruleId: number) {
    startTransition(async () => {
      const result = await removeWafRuleGloballyAction(ruleId);
      if (result.success) {
        toast.success(result.message ?? "Done");
        onRemove(ruleId);
      } else {
        toast.error(result.message ?? "Failed");
      }
    });
  }

  async function handleLookup() {
    const n = parseInt(addInput.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (excluded.includes(n)) {
      toast.error(`Rule ${n} is already suppressed.`);
      return;
    }
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
    return (
      String(id).includes(q) ||
      (messages[id] ?? "").toLowerCase().includes(q)
    );
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

      {/* Add rule */}
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleLookup}
            disabled={!addInput.trim() || lookupPending || pending}
          >
            {lookupPending ? "Looking up…" : "Look up"}
          </Button>
        </div>

        {pendingRule && (
          <div className="mt-3 px-4 py-3 rounded-lg border border-yellow-500 bg-muted max-w-[480px]">
            <p className="text-sm font-mono font-bold text-red-400">Rule {pendingRule.id}</p>
            <p className={cn("text-xs block mt-0.5", pendingRule.message ? "text-muted-foreground" : "text-muted-foreground/60")}>
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

      {/* Search */}
      {excluded.length > 0 && (
        <div className="relative max-w-[400px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by rule ID or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
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
            <div
              key={id}
              className="flex items-center gap-4 px-4 py-3 rounded-lg border bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-bold text-red-400">Rule {id}</p>
                <p className={cn("text-xs block mt-0.5", messages[id] ? "text-muted-foreground" : "text-muted-foreground/60")}>
                  {messages[id] ?? "No description available — rule has not triggered yet"}
                </p>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(id)}
                      disabled={pending}
                      className="shrink-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    >
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

export default function WafEventsClient({ events, pagination, initialSearch, globalExcluded, globalExcludedMessages, globalWafEnabled, hostWafMap, globalWaf }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("events");
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [selected, setSelected] = useState<WafEvent | null>(null);
  const [localGlobalExcluded, setLocalGlobalExcluded] = useState(globalExcluded);
  const [localGlobalMessages, setLocalGlobalMessages] = useState(globalExcludedMessages);
  const [localHostWafMap, setLocalHostWafMap] = useState(hostWafMap);
  const [wafState, wafFormAction] = useFormState(updateWafSettingsAction, null);
  const [wafCustomDirectives, setWafCustomDirectives] = useState(globalWaf?.custom_directives ?? "");
  const [wafShowTemplates, setWafShowTemplates] = useState(false);
  useEffect(() => { setSearchTerm(initialSearch); }, [initialSearch]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
          params.set("search", value.trim());
        } else {
          params.delete("search");
        }
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`);
      }, 400);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const mobileCard = (event: WafEvent) => (
    <Card
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setSelected(event)}
    >
      <CardContent className="p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <BlockedChip blocked={event.blocked} />
            <SeverityChip severity={event.severity} />
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(event.ts * 1000).toLocaleString()}
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground break-all">{event.host || "—"}</p>
        {event.ruleId && (
          <span className="text-xs text-muted-foreground/60">Rule #{event.ruleId}</span>
        )}
      </CardContent>
    </Card>
  );

  const columns = [
    {
      id: "ts", label: "Time", width: 150,
      render: (r: WafEvent) => (
        <span className="text-muted-foreground text-[0.8rem] whitespace-nowrap">
          {new Date(r.ts * 1000).toLocaleString()}
        </span>
      ),
    },
    {
      id: "blocked", label: "Action", width: 90,
      render: (r: WafEvent) => <BlockedChip blocked={r.blocked} />,
    },
    {
      id: "severity", label: "Severity", width: 100,
      render: (r: WafEvent) => <SeverityChip severity={r.severity} />,
    },
    {
      id: "host", label: "Host", width: 150,
      render: (r: WafEvent) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[0.8rem] max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap block">
                {r.host || <span className="opacity-40">—</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.host ?? ""}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      id: "clientIp", label: "Client IP", width: 140,
      render: (r: WafEvent) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-[0.8rem] whitespace-nowrap">{r.clientIp}</span>
          {r.countryCode && (
            <Badge variant="outline" className="text-[0.65rem] h-[18px] px-1">
              {r.countryCode}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "method", label: "M", width: 60,
      render: (r: WafEvent) => (
        <Badge variant="outline" className="font-mono text-[0.7rem]">{r.method || "—"}</Badge>
      ),
    },
    {
      id: "uri", label: "URI", width: 200,
      render: (r: WafEvent) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[0.8rem] max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap block">
                {r.uri || <span className="opacity-40">—</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.uri}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      id: "ruleId", label: "Rule ID", width: 80,
      render: (r: WafEvent) => (
        <span className="text-muted-foreground font-mono text-[0.8rem]">{r.ruleId ?? "—"}</span>
      ),
    },
    {
      id: "ruleMessage", label: "Rule Message",
      render: (r: WafEvent) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap block text-sm">
                {r.ruleMessage ?? <span className="opacity-40">—</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.ruleMessage ?? ""}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 w-full">
      <h1 className="text-3xl font-semibold">WAF</h1>
      <p className="text-muted-foreground">Web Application Firewall events and rule management.</p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="suppressed">Suppressed Rules</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="flex flex-col gap-4">
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
            onRowClick={setSelected}
            mobileCard={mobileCard}
          />
          <WafEventDrawer
            event={selected}
            onClose={() => setSelected(null)}
            globalExcluded={localGlobalExcluded}
            hostWafMap={localHostWafMap}
            onSuppressGlobal={(ruleId) => setLocalGlobalExcluded((prev) => [...new Set([...prev, ruleId])])}
            onSuppressHost={(ruleId, host) => setLocalHostWafMap((prev) => ({ ...prev, [host]: [...new Set([...(prev[host] ?? []), ruleId])] }))}
          />
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
              {wafState?.message && (
                <Alert variant={wafState.success ? "default" : "destructive"}>
                  <AlertDescription>{wafState.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-3">
                <Switch name="waf_enabled" defaultChecked={globalWaf?.enabled ?? false} id="waf_enabled" />
                <Label htmlFor="waf_enabled">Enable WAF globally (blocking)</Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox name="waf_load_owasp_crs" defaultChecked={globalWaf?.load_owasp_crs ?? true} id="waf_load_owasp_crs" />
                <Label htmlFor="waf_load_owasp_crs">
                  Load OWASP Core Rule Set{" "}
                  <span className="text-xs text-muted-foreground">(covers SQLi, XSS, LFI, RCE — recommended)</span>
                </Label>
              </div>
              {/* WafRuleExclusions intentionally omitted — managed in Suppressed Rules tab */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="waf_custom_directives">Custom SecLang Directives</Label>
                <Textarea
                  id="waf_custom_directives"
                  name="waf_custom_directives"
                  rows={3}
                  value={wafCustomDirectives}
                  onChange={(e) => setWafCustomDirectives(e.target.value)}
                  placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
                  className="font-mono text-[0.8rem] resize-y"
                />
                <p className="text-xs text-muted-foreground">ModSecurity SecLang syntax. Applied after OWASP CRS if enabled.</p>
              </div>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground px-0"
                  onClick={() => setWafShowTemplates((v) => !v)}
                >
                  Quick Templates
                  <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform duration-200", wafShowTemplates && "rotate-180")} />
                </Button>
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200",
                    wafShowTemplates ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                  )}
                >
                  <div className="flex flex-col gap-1.5 mt-2">
                    {[
                      { label: "Allow IP", snippet: `SecRule REMOTE_ADDR "@ipMatch 1.2.3.4" "id:9000,phase:1,allow,nolog,msg:'Allow IP'"` },
                      { label: "Disable WAF for path", snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"` },
                      { label: "Remove XSS rules", snippet: `SecRuleRemoveByTag "attack-xss"` },
                      { label: "Block User-Agent", snippet: `SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:9002,phase:1,deny,status:403,log"` },
                    ].map((t) => (
                      <Button
                        key={t.label}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="justify-start font-mono text-[0.72rem]"
                        onClick={() => setWafCustomDirectives((prev) => prev ? `${prev}\n${t.snippet}` : t.snippet)}
                      >
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
