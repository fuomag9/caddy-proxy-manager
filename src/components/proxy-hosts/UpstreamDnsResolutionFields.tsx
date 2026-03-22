import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ProxyHost } from "@/lib/models/proxy-hosts";

type ResolutionMode = "inherit" | "enabled" | "disabled";
type FamilyMode = "inherit" | "ipv6" | "ipv4" | "both";

function toResolutionMode(enabled: boolean | null | undefined): ResolutionMode {
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "inherit";
}

function toFamilyMode(family: "ipv6" | "ipv4" | "both" | null | undefined): FamilyMode {
  if (family === "ipv6" || family === "ipv4" || family === "both") {
    return family;
  }
  return "inherit";
}

export function UpstreamDnsResolutionFields({
  upstreamDnsResolution
}: {
  upstreamDnsResolution?: ProxyHost["upstream_dns_resolution"] | null;
}) {
  const mode = toResolutionMode(upstreamDnsResolution?.enabled);
  const family = toFamilyMode(upstreamDnsResolution?.family);
  const [expanded, setExpanded] = useState(mode !== "inherit" || family !== "inherit");
  const [currentMode, setCurrentMode] = useState<ResolutionMode>(mode);
  const [currentFamily, setCurrentFamily] = useState<FamilyMode>(family);

  const summary = currentMode === "inherit" && currentFamily === "inherit"
    ? "Using global upstream DNS pinning defaults"
    : `Override: ${currentMode === "inherit" ? "inherit mode" : currentMode}, ${currentFamily === "inherit" ? "inherit family" : currentFamily}`;

  return (
    <div className="rounded-lg border border-blue-500/60 bg-blue-500/5 p-5">
      <input type="hidden" name="upstream_dns_resolution_present" value="1" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Upstream DNS Pinning</p>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={expanded ? "Collapse upstream DNS pinning options" : "Expand upstream DNS pinning options"}
            onClick={() => setExpanded(prev => !prev)}
            className="h-8 w-8"
          >
            <ChevronDown className={cn(
              "h-4 w-4 transition-transform duration-200",
              expanded && "rotate-180"
            )} />
          </Button>
        </div>

        <div className={cn(
          "overflow-hidden transition-all duration-200",
          expanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        )}>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Resolution Mode</label>
              <input type="hidden" name="upstream_dns_resolution_mode" value={currentMode} />
              <Select value={currentMode} onValueChange={(v) => setCurrentMode(v as ResolutionMode)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit Global</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Inherit uses the global setting. Enabled/Disabled overrides per host.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Address Family Preference</label>
              <input type="hidden" name="upstream_dns_resolution_family" value={currentFamily} />
              <Select value={currentFamily} onValueChange={(v) => setCurrentFamily(v as FamilyMode)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit Global</SelectItem>
                  <SelectItem value="both">Both (Prefer IPv6)</SelectItem>
                  <SelectItem value="ipv6">IPv6 only</SelectItem>
                  <SelectItem value="ipv4">IPv4 only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Both resolves AAAA + A with IPv6 preferred ordering.</p>
            </div>
            <Alert>
              <AlertDescription>
                When enabled, hostname upstreams are resolved during config apply and written to Caddy as concrete IP dials. If this handler has
                multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those HTTPS upstreams to avoid SNI mismatch.
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </div>
  );
}
