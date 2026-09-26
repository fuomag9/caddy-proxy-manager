"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChevronDown, ClipboardCopy, ShieldOff } from "lucide-react";
import { useState } from "react";
import { type WafHostConfig } from "@/lib/models/proxy-hosts";
import { bytesToMib, MAX_BODY_LIMIT_MIB, MIN_BODY_LIMIT_MIB } from "@/lib/caddy-waf";
import { appendQuickTemplate, HOST_TEMPLATE_ID_OFFSET, WAF_QUICK_TEMPLATES } from "@/lib/waf-quick-templates";
import { WafRuleExclusions } from "./WafRuleExclusions";

type WafMode = "merge" | "override";
type EngineMode = "Off" | "On" | "inherit";
type LimitAction = "Reject" | "ProcessPartial" | "inherit";

type Props = {
  value?: WafHostConfig | null;
  showModeSelector?: boolean;
};

export function WafFields({ value, showModeSelector = true }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [wafMode, setWafMode] = useState<WafMode>(value?.waf_mode ?? "merge");
  const [engineMode, setEngineMode] = useState<EngineMode>(
    value?.mode === "Off" || value?.mode === "On" ? value.mode : "inherit"
  );
  const [loadCrs, setLoadCrs] = useState(value?.load_owasp_crs ?? true);
  const [customDirectives, setCustomDirectives] = useState(value?.custom_directives ?? "");
  const [showTemplates, setShowTemplates] = useState(false);
  const [bodyLimitMb, setBodyLimitMb] = useState(bytesToMib(value?.request_body_limit));
  const [inMemoryLimitMb, setInMemoryLimitMb] = useState(bytesToMib(value?.request_body_in_memory_limit));
  const [limitAction, setLimitAction] = useState<LimitAction>(value?.request_body_limit_action ?? "inherit");

  return (
    <div className="rounded-lg border border-destructive bg-destructive/5 p-4">
      <input type="hidden" name="wafPresent" value="1" />
      <input type="hidden" name="wafEnabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="wafMode" value={wafMode} />
      <input type="hidden" name="wafEngineMode" value={engineMode} />
      <input type="hidden" name="wafLoadOwaspCrs" value={loadCrs ? "on" : ""} />
      <input type="hidden" name="wafCustomDirectives" value={customDirectives} />
      <input type="hidden" name="wafRequestBodyLimitMb" value={bodyLimitMb} />
      <input type="hidden" name="wafRequestBodyInMemoryLimitMb" value={inMemoryLimitMb} />
      <input type="hidden" name="wafRequestBodyLimitAction" value={limitAction === "inherit" ? "" : limitAction} />

      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-row items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 w-8 h-8 rounded-xl bg-destructive flex items-center justify-center shrink-0">
            <ShieldOff className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug">Web Application Firewall</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Inspect and block malicious requests via Coraza / OWASP CRS
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          className="shrink-0"
        />
      </div>

      {/* Expanded content */}
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        enabled ? "max-h-[3000px] opacity-100 mt-4" : "max-h-0 opacity-0 pointer-events-none"
      )}>
        {/* Override mode selector */}
        {showModeSelector && (
          <>
            <div className="flex gap-2">
              {(["merge", "override"] as WafMode[]).map((v) => (
                <div
                  key={v}
                  onClick={() => setWafMode(v)}
                  className={cn(
                    "flex-1 py-2 px-3 rounded-xl border-[1.5px] cursor-pointer text-center transition-all duration-150 select-none",
                    wafMode === v
                      ? "border-destructive bg-destructive/10"
                      : "border-border hover:border-muted-foreground"
                  )}
                >
                  <p className={cn(
                    "text-sm transition-all duration-150",
                    wafMode === v ? "font-semibold text-destructive" : "font-normal text-muted-foreground"
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

        {/* Engine mode */}
        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
          Engine Mode
        </span>
        <div className="flex gap-2 mt-1.5">
          {(["inherit", "Off", "On"] as EngineMode[]).map((v) => (
            <div
              key={v}
              onClick={() => setEngineMode(v)}
              className={cn(
                "flex-1 py-2 px-2 rounded-xl border-[1.5px] cursor-pointer text-center transition-all duration-150 select-none",
                engineMode === v
                  ? "border-destructive bg-destructive/10"
                  : "border-border hover:border-muted-foreground"
              )}
            >
              <p className={cn(
                "text-[0.8rem] transition-all duration-150",
                engineMode === v ? "font-semibold text-destructive" : "font-normal text-muted-foreground"
              )}>
                {v === "inherit" ? "Global default" : v}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-border mt-4 mb-3" />

        {/* OWASP CRS */}
        <div className="flex items-start gap-2">
          <Checkbox
            id="waf-load-crs"
            checked={loadCrs}
            onCheckedChange={(checked) => setLoadCrs(!!checked)}
          />
          <label htmlFor="waf-load-crs" className="cursor-pointer">
            <p className="text-sm font-medium">Load OWASP Core Rule Set</p>
            <span className="text-xs text-muted-foreground">
              Covers SQLi, XSS, LFI, RCE and hundreds of other attack patterns
            </span>
          </label>
        </div>

        <div className="border-t border-border mt-4 mb-3" />

        {/* Request body limits */}
        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
          Request Body Limits
        </span>
        <p className="text-xs text-muted-foreground mt-1">
          Coraza buffers request bodies for inspection and rejects anything larger than its limit —
          12.5 MiB with the OWASP CRS loaded. Raise it for hosts that receive large uploads
          (Nextcloud, Immich, object storage). Leave blank to inherit.
        </p>
        <div className="flex gap-2 mt-2">
          <div className="flex-1">
            <Input
              type="number"
              min={MIN_BODY_LIMIT_MIB}
              max={MAX_BODY_LIMIT_MIB}
              step={1}
              placeholder="Inherit"
              value={bodyLimitMb}
              onChange={(e) => setBodyLimitMb(e.target.value)}
              className="text-sm"
            />
            <span className="text-xs text-muted-foreground">Max body size (MiB, up to {MAX_BODY_LIMIT_MIB})</span>
          </div>
          <div className="flex-1">
            <Input
              type="number"
              min={MIN_BODY_LIMIT_MIB}
              max={MAX_BODY_LIMIT_MIB}
              step={1}
              placeholder="Inherit"
              value={inMemoryLimitMb}
              onChange={(e) => setInMemoryLimitMb(e.target.value)}
              className="text-sm"
            />
            <span className="text-xs text-muted-foreground">Buffered in memory (MiB)</span>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {(["inherit", "Reject", "ProcessPartial"] as LimitAction[]).map((v) => (
            <div
              key={v}
              onClick={() => setLimitAction(v)}
              className={cn(
                "flex-1 py-2 px-2 rounded-xl border-[1.5px] cursor-pointer text-center transition-all duration-150 select-none",
                limitAction === v
                  ? "border-destructive bg-destructive/10"
                  : "border-border hover:border-muted-foreground"
              )}
            >
              <p className={cn(
                "text-[0.8rem] transition-all duration-150",
                limitAction === v ? "font-semibold text-destructive" : "font-normal text-muted-foreground"
              )}>
                {v === "inherit" ? "Global default" : v === "Reject" ? "Reject" : "Process partial"}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Over the limit: <strong>Reject</strong> returns 413; <strong>Process partial</strong> inspects
          the buffered portion and lets the rest through.
        </p>

        {/* Excluded rule IDs */}
        <div className="mt-4">
          <WafRuleExclusions value={value?.excluded_rule_ids} />
        </div>

        {/* Custom directives */}
        <div className="mt-4">
          <Textarea
            placeholder={`SecRule REQUEST_URI "@contains /secret" "id:9001,deny,status:403,log,msg:'Blocked path'"`}
            value={customDirectives}
            onChange={(e) => setCustomDirectives(e.target.value)}
            className="font-mono text-xs min-h-[80px]"
            rows={3}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Custom SecLang Directives — ModSecurity SecLang syntax. Appended after OWASP CRS if enabled.
          </p>
        </div>

        {/* Quick Templates */}
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowTemplates((v) => !v)}
            className="text-muted-foreground px-0 text-sm"
          >
            Quick Templates
            <ChevronDown className={cn(
              "h-4 w-4 ml-1 transition-transform duration-200",
              showTemplates && "rotate-180"
            )} />
          </Button>
          <div className={cn(
            "overflow-hidden transition-all duration-200",
            showTemplates ? "max-h-[500px] opacity-100 mt-2" : "max-h-0 opacity-0 pointer-events-none"
          )}>
            <div className="flex flex-col gap-1.5">
              {WAF_QUICK_TEMPLATES.map((t) => (
                <Button
                  key={t.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCustomDirectives((prev) => appendQuickTemplate(prev, t, HOST_TEMPLATE_ID_OFFSET))}
                  className="justify-start font-mono text-[0.72rem]"
                >
                  <ClipboardCopy className="h-3 w-3 mr-1 shrink-0" />
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
