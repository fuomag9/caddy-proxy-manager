import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ProxyHost } from "@/lib/models/proxy-hosts";

export function DnsResolverFields({
  dnsResolver
}: {
  dnsResolver?: ProxyHost["dns_resolver"] | null;
}) {
  const initial = dnsResolver ?? null;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);

  return (
    <div className="rounded-lg border border-emerald-500/60 bg-emerald-500/5 p-5">
      <input type="hidden" name="dns_present" value="1" />
      <input type="hidden" name="dns_enabled_present" value="1" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Custom DNS Resolvers</p>
            <p className="text-sm text-muted-foreground">
              Configure per-host DNS resolution for upstream discovery and health checks
            </p>
          </div>
          <Switch
            name="dns_enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className={cn(
          "overflow-hidden transition-all duration-200",
          enabled ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        )}>
          <div className="flex flex-col gap-5">
            <div>
              <label className="text-sm font-medium mb-1 block">DNS Resolvers</label>
              <Textarea
                name="dns_resolvers"
                placeholder={"1.1.1.1\n8.8.8.8"}
                defaultValue={initial?.resolvers?.join("\n") ?? ""}
                rows={2}
              />
              <p className="text-xs text-muted-foreground mt-1">
                One resolver per line (e.g., 1.1.1.1, 8.8.8.8). Used for dynamic upstream DNS resolution.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Fallback DNS Resolvers (Optional)</label>
              <Textarea
                name="dns_fallbacks"
                placeholder={"8.8.4.4\n1.0.0.1"}
                defaultValue={initial?.fallbacks?.join("\n") ?? ""}
                rows={2}
              />
              <p className="text-xs text-muted-foreground mt-1">Fallback resolvers if primary fails. One per line.</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">DNS Query Timeout</label>
              <Input
                name="dns_timeout"
                placeholder="5s"
                defaultValue={initial?.timeout ?? ""}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">Timeout for DNS queries (e.g., 5s, 10s)</p>
            </div>
            <Alert>
              <AlertDescription>
                Per-host DNS resolvers override global settings for this specific proxy host.
                Useful for upstream services that require specific DNS resolution (e.g., internal DNS, service discovery).
                Common resolvers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 9.9.9.9 (Quad9).
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </div>
  );
}
