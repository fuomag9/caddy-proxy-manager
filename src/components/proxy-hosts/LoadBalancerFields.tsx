import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ProxyHost, LoadBalancingPolicy } from "@/lib/models/proxy-hosts";

const LOAD_BALANCING_POLICIES = [
  { value: "random", label: "Random", description: "Random selection (default)" },
  { value: "round_robin", label: "Round Robin", description: "Sequential distribution" },
  { value: "least_conn", label: "Least Connections", description: "Fewest active connections" },
  { value: "ip_hash", label: "IP Hash", description: "Client IP-based sticky sessions" },
  { value: "first", label: "First Available", description: "First available upstream" },
  { value: "header", label: "Header Hash", description: "Hash based on request header" },
  { value: "cookie", label: "Cookie", description: "Cookie-based sticky sessions" },
  { value: "uri_hash", label: "URI Hash", description: "URI path-based distribution" }
];

export function LoadBalancerFields({
  loadBalancer
}: {
  loadBalancer?: ProxyHost["loadBalancer"] | null;
}) {
  const initial = loadBalancer ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [policy, setPolicy] = useState<LoadBalancingPolicy>(initial?.policy ?? "random");
  const [activeHealthEnabled, setActiveHealthEnabled] = useState(initial?.activeHealthCheck?.enabled ?? false);
  const [passiveHealthEnabled, setPassiveHealthEnabled] = useState(initial?.passiveHealthCheck?.enabled ?? false);

  const showHeaderField = policy === "header";
  const showCookieFields = policy === "cookie";

  return (
    <div className="rounded-lg border border-cyan-500/60 bg-cyan-500/5 p-5">
      <input type="hidden" name="lbPresent" value="1" />
      <input type="hidden" name="lbEnabledPresent" value="1" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Load Balancer</p>
            <p className="text-sm text-muted-foreground">
              Configure load balancing and health checks for multiple upstreams
            </p>
          </div>
          <Switch
            name="lbEnabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className={cn(
          "overflow-hidden transition-all duration-200",
          enabled ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        )}>
          <div className="flex flex-col gap-6">
            {/* Policy Selection */}
            <div>
              <p className="text-sm font-semibold mb-2">Selection Policy</p>
              <input type="hidden" name="lbPolicy" value={policy} />
              <Select value={policy} onValueChange={(v) => setPolicy(v as LoadBalancingPolicy)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select policy" />
                </SelectTrigger>
                <SelectContent>
                  {LOAD_BALANCING_POLICIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label} - {p.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Header-based policy fields */}
            <div className={cn(
              "overflow-hidden transition-all duration-200",
              showHeaderField ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
            )}>
              <div>
                <label className="text-sm font-medium mb-1 block">Header Field Name</label>
                <Input
                  name="lbPolicyHeaderField"
                  placeholder="X-Custom-Header"
                  defaultValue={initial?.policyHeaderField ?? ""}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">The request header to hash for upstream selection</p>
              </div>
            </div>

            {/* Cookie-based policy fields */}
            <div className={cn(
              "overflow-hidden transition-all duration-200",
              showCookieFields ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
            )}>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Cookie Name</label>
                  <Input
                    name="lbPolicyCookieName"
                    placeholder="server_id"
                    defaultValue={initial?.policyCookieName ?? ""}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Name of the cookie for sticky sessions</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Cookie Secret (Optional)</label>
                  <Input
                    name="lbPolicyCookieSecret"
                    placeholder="your-secret-key"
                    defaultValue={initial?.policyCookieSecret ?? ""}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Secret key for HMAC cookie signing</p>
                </div>
              </div>
            </div>

            {/* Retry Settings */}
            <div>
              <p className="text-sm font-semibold mb-2">Retry Settings</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Try Duration</label>
                  <Input
                    name="lbTryDuration"
                    placeholder="5s"
                    defaultValue={initial?.tryDuration ?? ""}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">How long to try upstreams</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Try Interval</label>
                  <Input
                    name="lbTryInterval"
                    placeholder="250ms"
                    defaultValue={initial?.tryInterval ?? ""}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Wait between attempts</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Max Retries</label>
                  <Input
                    name="lbRetries"
                    type="number"
                    min={0}
                    defaultValue={initial?.retries ?? ""}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Maximum retry attempts</p>
                </div>
              </div>
            </div>

            {/* Active Health Checks */}
            <div className="rounded-lg border border-border p-4">
              <input type="hidden" name="lbActiveHealthEnabledPresent" value="1" />
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <Switch
                    name="lbActiveHealthEnabled"
                    checked={activeHealthEnabled}
                    onCheckedChange={setActiveHealthEnabled}
                  />
                  <div>
                    <p className="text-sm font-semibold">Active Health Checks</p>
                    <span className="text-xs text-muted-foreground">Periodically probe upstreams to check health</span>
                  </div>
                </div>

                <div className={cn(
                  "overflow-hidden transition-all duration-200",
                  activeHealthEnabled ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                )}>
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Health Check URI</label>
                        <Input name="lbActiveHealthUri" placeholder="/health" defaultValue={initial?.activeHealthCheck?.uri ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Path to probe for health</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Health Check Port</label>
                        <Input name="lbActiveHealthPort" type="number" min={1} max={65535} defaultValue={initial?.activeHealthCheck?.port ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Override upstream port</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Check Interval</label>
                        <Input name="lbActiveHealthInterval" placeholder="30s" defaultValue={initial?.activeHealthCheck?.interval ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">How often to check</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Check Timeout</label>
                        <Input name="lbActiveHealthTimeout" placeholder="5s" defaultValue={initial?.activeHealthCheck?.timeout ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Timeout for health probe</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Expected Status Code</label>
                        <Input name="lbActiveHealthStatus" type="number" min={100} max={599} defaultValue={initial?.activeHealthCheck?.status ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Expected HTTP status</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Expected Body</label>
                        <Input name="lbActiveHealthBody" placeholder="OK" defaultValue={initial?.activeHealthCheck?.body ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Expected response body</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Passive Health Checks */}
            <div className="rounded-lg border border-border p-4">
              <input type="hidden" name="lbPassiveHealthEnabledPresent" value="1" />
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <Switch
                    name="lbPassiveHealthEnabled"
                    checked={passiveHealthEnabled}
                    onCheckedChange={setPassiveHealthEnabled}
                  />
                  <div>
                    <p className="text-sm font-semibold">Passive Health Checks</p>
                    <span className="text-xs text-muted-foreground">Mark upstreams unhealthy based on response failures</span>
                  </div>
                </div>

                <div className={cn(
                  "overflow-hidden transition-all duration-200",
                  passiveHealthEnabled ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                )}>
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Fail Duration</label>
                        <Input name="lbPassiveHealthFailDuration" placeholder="30s" defaultValue={initial?.passiveHealthCheck?.failDuration ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">How long to remember failures</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Max Failures</label>
                        <Input name="lbPassiveHealthMaxFails" type="number" min={0} defaultValue={initial?.passiveHealthCheck?.maxFails ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Failures before marking unhealthy</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Unhealthy Status Codes</label>
                        <Input name="lbPassiveHealthUnhealthyStatus" placeholder="500, 502, 503" defaultValue={initial?.passiveHealthCheck?.unhealthyStatus?.join(", ") ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Comma-separated status codes</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Unhealthy Latency</label>
                        <Input name="lbPassiveHealthUnhealthyLatency" placeholder="5s" defaultValue={initial?.passiveHealthCheck?.unhealthyLatency ?? ""} className="h-8 text-sm" />
                        <p className="text-xs text-muted-foreground mt-1">Latency threshold for unhealthy</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
