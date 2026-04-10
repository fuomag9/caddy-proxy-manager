"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Globe, Home, X } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { GeoBlockSettings } from "@/lib/settings";
import { GeoBlockMode } from "@/lib/models/proxy-hosts";
import { COUNTRIES, flagEmoji } from "./countries";

// ─── GeoIpStatus ─────────────────────────────────────────────────────────────

type GeoIpStatusData = { country: boolean; asn: boolean } | null;

function GeoIpStatus() {
  const [status, setStatus] = useState<GeoIpStatusData>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/geoip-status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" />;
  }

  const allLoaded = status?.country && status?.asn;
  const noneLoaded = !status?.country && !status?.asn;

  const label = allLoaded ? "GeoIP ready" : noneLoaded ? "GeoIP missing" : "GeoIP partial";
  const tooltip = noneLoaded
    ? "GeoIP databases not found — country/continent/ASN blocking will not work. Enable the geoipupdate service."
    : !status?.country
    ? "GeoLite2-Country database missing — country/continent blocking disabled"
    : !status?.asn
    ? "GeoLite2-ASN database missing — ASN blocking disabled"
    : "GeoLite2-Country and GeoLite2-ASN databases loaded";

  return (
    <span title={tooltip}>
      <Badge
        variant="outline"
        className={cn(
          "h-[22px] text-[0.7rem] font-semibold tracking-wide cursor-default",
          allLoaded ? "border-green-500 text-green-600" : noneLoaded ? "border-destructive text-destructive" : "border-yellow-500 text-yellow-600"
        )}
      >
        {label}
      </Badge>
    </span>
  );
}

// ─── CountryPicker ────────────────────────────────────────────────────────────

const CONTINENTS = [
  { code: "AF", name: "Africa", emoji: "🌍" },
  { code: "AN", name: "Antarctica", emoji: "🧊" },
  { code: "AS", name: "Asia", emoji: "🌏" },
  { code: "EU", name: "Europe", emoji: "🌍" },
  { code: "NA", name: "N. America", emoji: "🌎" },
  { code: "OC", name: "Oceania", emoji: "🌏" },
  { code: "SA", name: "S. America", emoji: "🌎" },
];

type CountryPickerProps = {
  name: string;
  initialValues?: string[];
  accentColor?: "warning" | "success";
};

function CountryPicker({ name, initialValues = [], accentColor = "warning" }: CountryPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialValues.map((c) => c.toUpperCase()).filter(Boolean))
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().startsWith(q)
    );
  }, [search]);

  const toggle = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const selectFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.add(c.code));
      return next;
    });
  }, [filtered]);

  const clearFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.delete(c.code));
      return next;
    });
  }, [filtered]);

  const selectedInFiltered = filtered.filter((c) => selected.has(c.code)).length;
  const allFilteredSelected = filtered.length > 0 && selectedInFiltered === filtered.length;

  const isWarning = accentColor === "warning";

  return (
    <div>
      <input type="hidden" name={name} value={[...selected].join(",")} />

      {/* Search */}
      <div className="relative mb-1.5">
        <Input
          placeholder="Search by country name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm pr-8"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">
          {selected.size > 0 ? (
            <>{selected.size} selected{search && `, ${selectedInFiltered} shown`}</>
          ) : (
            <span className="opacity-50">None selected</span>
          )}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectFiltered}
            disabled={allFilteredSelected}
            className="text-[0.7rem] py-0.5 px-1.5 h-auto"
          >
            {search ? "Select matching" : "Select all"}
          </Button>
          <span className="text-xs text-muted-foreground">·</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFiltered}
            disabled={selectedInFiltered === 0}
            className="text-[0.7rem] py-0.5 px-1.5 h-auto"
          >
            {search ? "Clear matching" : "Clear all"}
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="max-h-[220px] overflow-y-auto flex flex-wrap gap-1 p-1.5 rounded-xl border border-border bg-black/[0.015] dark:bg-white/[0.02]">
        {filtered.length === 0 ? (
          <span className="text-xs text-muted-foreground p-1">
            No countries match &ldquo;{search}&rdquo;
          </span>
        ) : (
          filtered.map((country) => {
            const isSelected = selected.has(country.code);
            return (
              <button
                key={country.code}
                type="button"
                onClick={() => toggle(country.code)}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border transition-all duration-100 cursor-pointer h-[26px]",
                  isSelected
                    ? isWarning
                      ? "border-yellow-500 bg-yellow-500/10 font-semibold text-yellow-700 dark:text-yellow-400"
                      : "border-green-500 bg-green-500/10 font-semibold text-green-700 dark:text-green-400"
                    : "border-border hover:border-muted-foreground hover:bg-accent"
                )}
              >
                <span className="text-[0.85rem] leading-none">{flagEmoji(country.code)}</span>
                <span>{country.name}</span>
                <span className="opacity-55 text-[0.6rem] font-mono">{country.code}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Selected summary chips (shown when search is active and selected items are hidden) */}
      {search && selected.size > 0 && (
        <div className="mt-1.5">
          <span className="text-xs text-muted-foreground block mb-1">All selected ({selected.size}):</span>
          <div className="flex flex-wrap gap-1 max-h-[72px] overflow-y-auto">
            {[...selected].map((code) => {
              const country = COUNTRIES.find((c) => c.code === code);
              return (
                <Badge
                  key={code}
                  variant="secondary"
                  className={cn(
                    "gap-1 pr-1 text-[0.7rem] h-[22px] font-semibold",
                    isWarning
                      ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                      : "bg-green-500/10 text-green-700 dark:text-green-400"
                  )}
                >
                  <span className="text-[0.8rem]">{flagEmoji(code)}</span>
                  {country?.name ?? code}
                  <button
                    type="button"
                    onClick={() => toggle(code)}
                    className="rounded-full hover:bg-destructive/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ContinentPicker ──────────────────────────────────────────────────────────

type ContinentPickerProps = {
  name: string;
  initialValues?: string[];
  accentColor?: "warning" | "success";
};

function ContinentPicker({ name, initialValues = [], accentColor = "warning" }: ContinentPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialValues.map((c) => c.toUpperCase()).filter(Boolean))
  );

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const isWarning = accentColor === "warning";

  return (
    <div>
      <input type="hidden" name={name} value={[...selected].join(",")} />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selected` : <span className="opacity-50">None selected</span>}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(CONTINENTS.map((c) => c.code)))}
            disabled={selected.size === CONTINENTS.length}
            className="text-[0.7rem] py-0.5 px-1.5 h-auto"
          >
            Select all
          </Button>
          <span className="text-xs text-muted-foreground">·</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="text-[0.7rem] py-0.5 px-1.5 h-auto"
          >
            Clear all
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CONTINENTS.map((c) => {
          const isSelected = selected.has(c.code);
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => toggle(c.code)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-[1.5px] cursor-pointer select-none transition-all duration-100",
                isSelected
                  ? isWarning
                    ? "border-yellow-500 bg-yellow-500/10 shadow-[0_0_0_1px_rgba(237,108,2,0.25)]"
                    : "border-green-500 bg-green-500/10 shadow-[0_0_0_1px_rgba(46,125,50,0.25)]"
                  : "border-border hover:border-muted-foreground hover:bg-accent"
              )}
            >
              <span className="text-base leading-none">{c.emoji}</span>
              <div>
                <span className={cn(
                  "block text-xs leading-snug transition-all duration-100",
                  isSelected
                    ? isWarning ? "font-bold text-yellow-700 dark:text-yellow-400" : "font-bold text-green-700 dark:text-green-400"
                    : "font-normal text-foreground"
                )}>
                  {c.name}
                </span>
                <span className="text-[0.62rem] text-muted-foreground font-mono">{c.code}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── TagInput ────────────────────────────────────────────────────────────────

type TagInputProps = {
  name: string;
  label: string;
  initialValues?: string[];
  placeholder?: string;
  helperText?: string;
  validate?: (value: string) => boolean;
  uppercase?: boolean;
};

function TagInput({ name, label, initialValues = [], placeholder, helperText, validate, uppercase = false }: TagInputProps) {
  const [tags, setTags] = useState<string[]>(initialValues);
  const [inputValue, setInputValue] = useState("");

  function processValue(raw: string): string {
    return uppercase ? raw.trim().toUpperCase() : raw.trim();
  }

  function commitInput(raw: string) {
    const value = processValue(raw);
    if (!value) return;
    if (validate && !validate(value)) return;
    if (tags.includes(value)) {
      setInputValue("");
      return;
    }
    setTags((prev) => [...prev, value]);
    setInputValue("");
  }

  return (
    <div>
      <input type="hidden" name={name} value={tags.join(",")} />
      <label className="text-sm font-medium mb-1 block">{label}</label>
      <div className={cn(
        "flex flex-wrap items-center gap-1 min-h-9 border border-input rounded-md px-3 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        tags.length > 0 && "pb-1"
      )}>
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs h-5">
            {tag}
            <button
              type="button"
              onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              className="rounded-full hover:bg-destructive/20 p-0.5"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={inputValue}
          placeholder={tags.length === 0 ? placeholder : undefined}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "," || e.key === " " || e.key === "Enter") {
              e.preventDefault();
              commitInput(inputValue);
            }
            if (e.key === "Backspace" && !inputValue && tags.length > 0) {
              setTags((prev) => prev.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (inputValue.trim()) commitInput(inputValue);
          }}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>
      {helperText && <p className="text-xs text-muted-foreground mt-1">{helperText}</p>}
    </div>
  );
}

// ─── ResponseHeadersEditor ────────────────────────────────────────────────────

type HeaderRow = { key: string; value: string };

function ResponseHeadersEditor({ initialHeaders }: { initialHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    Object.entries(initialHeaders).map(([key, value]) => ({ key, value }))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">Custom Response Headers</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setRows((prev) => [...prev, { key: "", value: "" }])}
          title="Add header"
        >
          <span className="text-base leading-none">+</span>
        </Button>
      </div>
      {rows.length === 0 ? (
        <span className="text-xs text-muted-foreground">No custom headers — click + to add one.</span>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <input type="hidden" name="geoblock_response_headers_keys[]" value={row.key} />
              <input type="hidden" name="geoblock_response_headers_values[]" value={row.value} />
              <Input
                placeholder="Header"
                value={row.key}
                onChange={(e) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                className="h-8 text-sm"
              />
              <Input
                placeholder="Value"
                value={row.value}
                onChange={(e) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                className="h-8 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                title="Remove"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RulesPanel ───────────────────────────────────────────────────────────────

type RulesPanelProps = {
  prefix: "block" | "allow";
  initial: GeoBlockSettings | null;
  resetKey?: number;
};

function RulesPanel({ prefix, initial, resetKey = 0 }: RulesPanelProps) {
  const accentColor = prefix === "block" ? "warning" : "success";
  const countries = prefix === "block" ? (initial?.block_countries ?? []) : (initial?.allow_countries ?? []);
  const continents = prefix === "block" ? (initial?.block_continents ?? []) : (initial?.allow_continents ?? []);
  const asns = prefix === "block" ? (initial?.block_asns ?? []) : (initial?.allow_asns ?? []);
  const cidrs = prefix === "block" ? (initial?.block_cidrs ?? []) : (initial?.allow_cidrs ?? []);
  const ips = prefix === "block" ? (initial?.block_ips ?? []) : (initial?.allow_ips ?? []);

  return (
    <div className="flex flex-col gap-6">
      {/* Countries */}
      <div>
        <p className="text-sm font-semibold mb-2">Countries</p>
        <CountryPicker
          name={`geoblock_${prefix}_countries`}
          initialValues={countries}
          accentColor={accentColor}
        />
      </div>

      <div className="border-t border-border" />

      {/* Continents */}
      <div>
        <p className="text-sm font-semibold mb-2">Continents</p>
        <ContinentPicker
          name={`geoblock_${prefix}_continents`}
          initialValues={continents}
          accentColor={accentColor}
        />
      </div>

      <div className="border-t border-border" />

      {/* ASNs */}
      <TagInput
        name={`geoblock_${prefix}_asns`}
        label="ASNs"
        initialValues={asns.map(String)}
        placeholder="13335, 15169…"
        helperText="Autonomous System Numbers — press Enter or comma to add"
        validate={(v) => /^\d+$/.test(v)}
      />

      {/* CIDRs + IPs */}
      <div className="grid grid-cols-2 gap-4">
        <TagInput
          key={`${prefix}-cidrs-${resetKey}`}
          name={`geoblock_${prefix}_cidrs`}
          label="CIDRs"
          initialValues={cidrs}
          placeholder="10.0.0.0/8…"
          helperText="Press Enter or comma to add"
        />
        <TagInput
          key={`${prefix}-ips-${resetKey}`}
          name={`geoblock_${prefix}_ips`}
          label="IP Addresses"
          initialValues={ips}
          placeholder="1.2.3.4…"
          helperText="Press Enter or comma to add"
        />
      </div>
    </div>
  );
}

// ─── GeoBlockFields ───────────────────────────────────────────────────────────

type GeoBlockFieldsProps = {
  initialValues?: {
    geoblock: GeoBlockSettings | null;
    geoblock_mode: GeoBlockMode;
  };
  showModeSelector?: boolean;
};

const RFC1918_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const BLOCK_ALL_CIDR = "0.0.0.0/0";

export function GeoBlockFields({ initialValues, showModeSelector = true }: GeoBlockFieldsProps) {
  const rawInitial = initialValues?.geoblock ?? null;
  const [enabled, setEnabled] = useState(rawInitial?.enabled ?? false);
  const [mode, setMode] = useState<GeoBlockMode>(initialValues?.geoblock_mode ?? "merge");
  const [resetKey, setResetKey] = useState(0);
  const [initial, setInitial] = useState<GeoBlockSettings | null>(rawInitial);

  function applyLanOnlyPreset() {
    setEnabled(true);
    setInitial((prev) => ({
      enabled: true,
      block_countries: prev?.block_countries ?? [],
      block_continents: prev?.block_continents ?? [],
      block_asns: prev?.block_asns ?? [],
      block_cidrs: [BLOCK_ALL_CIDR],
      block_ips: prev?.block_ips ?? [],
      allow_countries: prev?.allow_countries ?? [],
      allow_continents: prev?.allow_continents ?? [],
      allow_asns: prev?.allow_asns ?? [],
      allow_cidrs: RFC1918_CIDRS,
      allow_ips: prev?.allow_ips ?? [],
      trusted_proxies: prev?.trusted_proxies ?? [],
      fail_closed: prev?.fail_closed ?? false,
      response_status: prev?.response_status ?? 403,
      response_body: prev?.response_body ?? "Forbidden",
      response_headers: prev?.response_headers ?? {},
      redirect_url: prev?.redirect_url ?? "",
    }));
    setResetKey((k) => k + 1);
  }

  return (
    <div className="rounded-lg border border-rose-500/60 bg-rose-500/5 p-4">
      <input type="hidden" name="geoblock_present" value="1" />

      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-row items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 w-8 h-8 rounded-xl bg-rose-500 flex items-center justify-center shrink-0">
            <Globe className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-row items-center gap-2 flex-wrap">
              <p className="text-sm font-bold leading-snug">Geo Blocking</p>
              <GeoIpStatus />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Block or allow traffic by country, continent, ASN, CIDR, or IP
            </p>
          </div>
        </div>
        <Switch
          name="geoblock_enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          className="shrink-0"
        />
      </div>

      {/* Mode selector */}
      <input type="hidden" name="geoblock_mode" value={mode} />

      {/* Detail fields */}
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        enabled ? "max-h-[3000px] opacity-100 mt-4" : "max-h-0 opacity-0 pointer-events-none"
      )}>
        {showModeSelector && (
          <>
            <div className="flex gap-2">
              {(["merge", "override"] as GeoBlockMode[]).map((v) => (
                <div
                  key={v}
                  onClick={() => setMode(v)}
                  className={cn(
                    "flex-1 py-2 px-3 rounded-xl border-[1.5px] cursor-pointer text-center transition-all duration-150 select-none",
                    mode === v
                      ? "border-yellow-500 bg-yellow-500/10"
                      : "border-border hover:border-muted-foreground"
                  )}
                >
                  <p className={cn(
                    "text-sm transition-all duration-150",
                    mode === v ? "font-semibold text-yellow-700 dark:text-yellow-400" : "font-normal text-muted-foreground"
                  )}>
                    {v === "merge" ? "Merge with global" : "Override global"}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-border mt-4 mb-4" />
          </>
        )}
        {!showModeSelector && <div className="border-t border-border mb-4" />}

        {/* Presets */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">Presets:</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={applyLanOnlyPreset}
          >
            <Home className="h-3 w-3" />
            LAN Only (RFC1918)
          </Button>
        </div>

        {/* Block / Allow tabs */}
        <Tabs defaultValue="block">
          <TabsList className="w-full">
            <TabsTrigger value="block" className="flex-1">Block Rules</TabsTrigger>
            <TabsTrigger value="allow" className="flex-1">Allow Rules</TabsTrigger>
          </TabsList>
          <TabsContent value="block" className="mt-4">
            <RulesPanel prefix="block" initial={initial} resetKey={resetKey} />
          </TabsContent>
          <TabsContent value="allow" className="mt-4">
            <p className="text-xs text-muted-foreground mb-3">
              Allow rules take precedence over block rules.
            </p>
            <RulesPanel prefix="allow" initial={initial} resetKey={resetKey} />
          </TabsContent>
        </Tabs>

        {/* Advanced: Trusted Proxies + Block Response */}
        <div className="mt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="advanced" className="border rounded-lg border-border">
              <AccordionTrigger className="px-4 py-2.5 text-sm font-medium hover:no-underline">
                Trusted Proxies &amp; Block Response
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="flex flex-col gap-4">
                  <TagInput
                    name="geoblock_trusted_proxies"
                    label="Trusted Proxies"
                    initialValues={initial?.trusted_proxies ?? []}
                    placeholder="private_ranges, 10.0.0.0/8…"
                    helperText="Used to parse X-Forwarded-For. Use private_ranges for all RFC-1918 ranges."
                  />

                  <div className="flex items-center gap-2" title="When enabled, requests where the real client IP cannot be determined (e.g. behind a trusted proxy with no usable X-Forwarded-For) are blocked. Default: off (fail-open).">
                    <Checkbox
                      id="geoblock-fail-closed"
                      name="geoblock_fail_closed"
                      defaultChecked={initial?.fail_closed ?? false}
                    />
                    <label htmlFor="geoblock-fail-closed" className="text-sm cursor-pointer">
                      Fail closed (block indeterminate IPs)
                    </label>
                  </div>

                  <div className="border-t border-border" />

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <label className="text-sm font-medium mb-1 block">Status Code</label>
                      <Input
                        name="geoblock_response_status"
                        type="number"
                        min={100}
                        max={599}
                        defaultValue={initial?.response_status ?? 403}
                        className="h-8 text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">HTTP status when blocked</p>
                    </div>
                    <div className="col-span-2">
                      <label className="text-sm font-medium mb-1 block">Response Body</label>
                      <Input
                        name="geoblock_response_body"
                        defaultValue={initial?.response_body ?? "Forbidden"}
                        className="h-8 text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Body text returned to blocked clients</p>
                    </div>
                    <div className="col-span-3">
                      <label className="text-sm font-medium mb-1 block">Redirect URL</label>
                      <Input
                        name="geoblock_redirect_url"
                        defaultValue={initial?.redirect_url ?? ""}
                        placeholder="https://example.com/blocked"
                        className="h-8 text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">If set, sends a 302 redirect instead of status/body above</p>
                    </div>
                  </div>

                  <ResponseHeadersEditor initialHeaders={initial?.response_headers ?? {}} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
