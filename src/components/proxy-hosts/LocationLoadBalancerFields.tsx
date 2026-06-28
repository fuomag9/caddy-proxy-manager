"use client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LoadBalancerConfig, LoadBalancingPolicy } from "@/lib/models/proxy-hosts";

const LOAD_BALANCING_POLICIES: { value: LoadBalancingPolicy; label: string }[] = [
  { value: "random", label: "Random (default)" },
  { value: "round_robin", label: "Round Robin" },
  { value: "least_conn", label: "Least Connections" },
  { value: "ip_hash", label: "IP Hash" },
  { value: "first", label: "First Available" },
  { value: "header", label: "Header Hash" },
  { value: "cookie", label: "Cookie" },
  { value: "uri_hash", label: "URI Hash" },
];

export const EMPTY_LOAD_BALANCER: LoadBalancerConfig = {
  enabled: true,
  policy: "random",
  policyHeaderField: null,
  policyCookieName: null,
  policyCookieSecret: null,
  tryDuration: null,
  tryInterval: null,
  retries: null,
  activeHealthCheck: null,
  passiveHealthCheck: null,
};

const EMPTY_ACTIVE = { enabled: true, uri: null, port: null, interval: null, timeout: null, status: null, body: null };
const EMPTY_PASSIVE = { enabled: true, failDuration: null, maxFails: null, unhealthyStatus: null, unhealthyLatency: null };

function str(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}
function num(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Props = {
  value: LoadBalancerConfig | null;
  onChange: (value: LoadBalancerConfig | null) => void;
};

/**
 * Controlled per-location-rule load balancer / health check editor. Mirrors the
 * host-level LoadBalancerFields but drives a single object via onChange so it can
 * be serialized into the location-rules JSON payload.
 */
export function LocationLoadBalancerFields({ value, onChange }: Props) {
  const lb = value;
  const enabled = Boolean(lb?.enabled);
  const policy = lb?.policy ?? "random";
  const patch = (changes: Partial<LoadBalancerConfig>) => onChange({ ...(lb ?? EMPTY_LOAD_BALANCER), ...changes });

  return (
    <div className="rounded-md border border-cyan-500/50 bg-cyan-500/5 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Load Balancer</p>
          <p className="text-xs text-muted-foreground">Health checks &amp; balancing for this path&apos;s upstreams</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(on) => onChange(on ? { ...(lb ?? EMPTY_LOAD_BALANCER), enabled: true } : null)} />
      </div>

      <div className={cn("overflow-hidden transition-all duration-200", enabled ? "mt-3 max-h-[3000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none")}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium mb-1 block">Selection Policy</label>
            <Select value={policy} onValueChange={(v) => patch({ policy: v as LoadBalancingPolicy })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOAD_BALANCING_POLICIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {policy === "header" && (
            <div>
              <label className="text-xs font-medium mb-1 block">Header Field Name</label>
              <Input className="h-8 text-sm" placeholder="X-Custom-Header" value={lb?.policyHeaderField ?? ""} onChange={(e) => patch({ policyHeaderField: str(e.target.value) })} />
            </div>
          )}

          {policy === "cookie" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Cookie Name</label>
                <Input className="h-8 text-sm" placeholder="server_id" value={lb?.policyCookieName ?? ""} onChange={(e) => patch({ policyCookieName: str(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Cookie Secret (optional)</label>
                <Input className="h-8 text-sm" placeholder="secret" value={lb?.policyCookieSecret ?? ""} onChange={(e) => patch({ policyCookieSecret: str(e.target.value) })} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Try Duration</label>
              <Input className="h-8 text-sm" placeholder="5s" value={lb?.tryDuration ?? ""} onChange={(e) => patch({ tryDuration: str(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Try Interval</label>
              <Input className="h-8 text-sm" placeholder="250ms" value={lb?.tryInterval ?? ""} onChange={(e) => patch({ tryInterval: str(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Max Retries</label>
              <Input className="h-8 text-sm" type="number" min={0} value={lb?.retries ?? ""} onChange={(e) => patch({ retries: num(e.target.value) })} />
            </div>
          </div>

          {/* Active health checks */}
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={Boolean(lb?.activeHealthCheck?.enabled)}
                onCheckedChange={(on) => patch({ activeHealthCheck: on ? { ...(lb?.activeHealthCheck ?? EMPTY_ACTIVE), enabled: true } : null })}
              />
              <p className="text-sm font-medium">Active Health Checks</p>
            </div>
            {lb?.activeHealthCheck?.enabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">URI</label>
                  <Input className="h-8 text-sm" placeholder="/health" value={lb.activeHealthCheck.uri ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, uri: str(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Port</label>
                  <Input className="h-8 text-sm" type="number" min={1} max={65535} value={lb.activeHealthCheck.port ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, port: num(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Interval</label>
                  <Input className="h-8 text-sm" placeholder="30s" value={lb.activeHealthCheck.interval ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, interval: str(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Timeout</label>
                  <Input className="h-8 text-sm" placeholder="5s" value={lb.activeHealthCheck.timeout ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, timeout: str(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Expected Status</label>
                  <Input className="h-8 text-sm" type="number" min={100} max={599} value={lb.activeHealthCheck.status ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, status: num(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Expected Body</label>
                  <Input className="h-8 text-sm" placeholder="OK" value={lb.activeHealthCheck.body ?? ""} onChange={(e) => patch({ activeHealthCheck: { ...lb.activeHealthCheck!, body: str(e.target.value) } })} />
                </div>
              </div>
            )}
          </div>

          {/* Passive health checks */}
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={Boolean(lb?.passiveHealthCheck?.enabled)}
                onCheckedChange={(on) => patch({ passiveHealthCheck: on ? { ...(lb?.passiveHealthCheck ?? EMPTY_PASSIVE), enabled: true } : null })}
              />
              <p className="text-sm font-medium">Passive Health Checks</p>
            </div>
            {lb?.passiveHealthCheck?.enabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Fail Duration</label>
                  <Input className="h-8 text-sm" placeholder="30s" value={lb.passiveHealthCheck.failDuration ?? ""} onChange={(e) => patch({ passiveHealthCheck: { ...lb.passiveHealthCheck!, failDuration: str(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Max Failures</label>
                  <Input className="h-8 text-sm" type="number" min={0} value={lb.passiveHealthCheck.maxFails ?? ""} onChange={(e) => patch({ passiveHealthCheck: { ...lb.passiveHealthCheck!, maxFails: num(e.target.value) } })} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Unhealthy Status Codes</label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="500, 502, 503"
                    value={lb.passiveHealthCheck.unhealthyStatus?.join(", ") ?? ""}
                    onChange={(e) => {
                      const codes = e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 100);
                      patch({ passiveHealthCheck: { ...lb.passiveHealthCheck!, unhealthyStatus: codes.length > 0 ? codes : null } });
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Unhealthy Latency</label>
                  <Input className="h-8 text-sm" placeholder="5s" value={lb.passiveHealthCheck.unhealthyLatency ?? ""} onChange={(e) => patch({ passiveHealthCheck: { ...lb.passiveHealthCheck!, unhealthyLatency: str(e.target.value) } })} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
