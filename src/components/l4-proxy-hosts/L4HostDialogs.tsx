"use client";

import { useFormState } from "react-dom";
import { useEffect, useState } from "react";
import {
  createL4ProxyHostAction,
  deleteL4ProxyHostAction,
  updateL4ProxyHostAction,
} from "@/app/(dashboard)/l4-proxy-hosts/actions";
import { INITIAL_ACTION_STATE } from "@/lib/actions";
import type { L4ProxyHost } from "@/lib/models/l4-proxy-hosts";
import { AppDialog } from "@/components/ui/AppDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { Globe, Layers, MapPin, Pin } from "lucide-react";

function FormField({
  label,
  htmlFor,
  helperText,
  children,
}: {
  label: string;
  htmlFor: string;
  helperText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

function L4HostForm({
  formId,
  formAction,
  state,
  initialData,
}: {
  formId: string;
  formAction: (formData: FormData) => void;
  state: { status: string; message?: string };
  initialData?: L4ProxyHost | null;
}) {
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [protocol, setProtocol] = useState(initialData?.protocol ?? "tcp");
  const [matcherType, setMatcherType] = useState(
    initialData?.matcherType ?? "none"
  );

  const defaultLbAccordion = initialData?.loadBalancer?.enabled
    ? "load-balancer"
    : undefined;
  const defaultDnsAccordion = initialData?.dnsResolver?.enabled
    ? "dns-resolver"
    : undefined;
  const defaultGeoblockAccordion = initialData?.geoblock?.enabled
    ? "geoblock"
    : undefined;
  const defaultUpstreamDnsAccordion =
    initialData?.upstreamDnsResolution?.enabled === true
      ? "upstream-dns"
      : undefined;

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-5">
      {state.status !== "idle" && state.message && (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="enabledPresent" value="1" />
      <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
      <div className={cn(
        "flex flex-row items-center justify-between p-4 rounded-lg border transition-all duration-200",
        enabled
          ? "border-primary bg-primary/5"
          : "border-border bg-background"
      )}>
        <div>
          <p className={cn("text-sm font-semibold", enabled ? "text-primary" : "text-foreground")}>
            {enabled ? "L4 Host Enabled" : "L4 Host Paused"}
          </p>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "This host is active and proxying connections"
              : "This host is disabled and will not accept connections"}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <FormField label="Name" htmlFor="name">
        <Input
          id="name"
          name="name"
          placeholder="PostgreSQL Proxy"
          defaultValue={initialData?.name ?? ""}
          required
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="protocol">Protocol</Label>
        <Select
          name="protocol"
          value={protocol}
          onValueChange={(v) => setProtocol(v as "tcp" | "udp")}
        >
          <SelectTrigger id="protocol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tcp">
              <div className="flex items-center gap-2">
                <Badge variant="info" className="text-[10px] px-1.5 py-0">TCP</Badge>
                TCP
              </div>
            </SelectItem>
            <SelectItem value="udp">
              <div className="flex items-center gap-2">
                <Badge variant="warning" className="text-[10px] px-1.5 py-0">UDP</Badge>
                UDP
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <FormField
        label="Listen Address"
        htmlFor="listenAddress"
        helperText="Format: :PORT or HOST:PORT. Make sure to expose this port in docker-compose.yml on the caddy service."
      >
        <Input
          id="listenAddress"
          name="listenAddress"
          placeholder=":5432"
          defaultValue={initialData?.listenAddress ?? ""}
          required
        />
      </FormField>

      <FormField
        label="Upstreams"
        htmlFor="upstreams"
        helperText="One per line in host:port format."
      >
        <Textarea
          id="upstreams"
          name="upstreams"
          placeholder={"10.0.0.1:5432\n10.0.0.2:5432"}
          defaultValue={initialData?.upstreams.join("\n") ?? ""}
          rows={2}
          required
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="matcherType">Matcher</Label>
        <Select
          name="matcherType"
          value={matcherType}
          onValueChange={(v) =>
            setMatcherType(
              v as "none" | "tls_sni" | "http_host" | "proxy_protocol"
            )
          }
        >
          <SelectTrigger id="matcherType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (catch-all)</SelectItem>
            <SelectItem value="tls_sni">TLS SNI</SelectItem>
            <SelectItem value="http_host">HTTP Host</SelectItem>
            <SelectItem value="proxy_protocol">Proxy Protocol</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Match incoming connections before proxying. &apos;None&apos; matches
          all connections on this port.
        </p>
      </div>

      {(matcherType === "tls_sni" || matcherType === "http_host") && (
        <FormField
          label={matcherType === "tls_sni" ? "SNI Hostnames" : "HTTP Hostnames"}
          htmlFor="matcherValue"
          helperText="Comma-separated list of hostnames to match."
        >
          <Input
            id="matcherValue"
            name="matcherValue"
            placeholder="db.example.com, api.example.com"
            defaultValue={initialData?.matcherValue?.join(", ") ?? ""}
            required
          />
        </FormField>
      )}

      {protocol === "tcp" && (
        <div className="flex items-center gap-2">
          <Switch
            id="tlsTermination"
            name="tlsTermination"
            defaultChecked={initialData?.tlsTermination ?? false}
          />
          <Label htmlFor="tlsTermination">TLS Termination</Label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="proxyProtocolReceive"
          name="proxyProtocolReceive"
          defaultChecked={initialData?.proxyProtocolReceive ?? false}
        />
        <Label htmlFor="proxyProtocolReceive">
          Accept inbound PROXY protocol
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proxyProtocolVersion">
          Send PROXY protocol to upstream
        </Label>
        <Select
          name="proxyProtocolVersion"
          defaultValue={initialData?.proxyProtocolVersion ?? "__none__"}
        >
          <SelectTrigger id="proxyProtocolVersion">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            <SelectItem value="v1">v1</SelectItem>
            <SelectItem value="v2">v2</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Load Balancer */}
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultLbAccordion}
        className="border-l-2 border-l-cyan-500 border rounded-md px-3"
      >
        <AccordionItem value="load-balancer" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium hover:no-underline">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-500">
                <Layers className="h-3.5 w-3.5" />
              </div>
              Load Balancer
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="lbPresent" value="1" />
              <input type="hidden" name="lbEnabledPresent" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="lbEnabled"
                  name="lbEnabled"
                  defaultChecked={
                    initialData?.loadBalancer?.enabled ?? false
                  }
                />
                <Label htmlFor="lbEnabled">Enable Load Balancing</Label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lbPolicy">Policy</Label>
                <Select
                  name="lbPolicy"
                  defaultValue={
                    initialData?.loadBalancer?.policy ?? "random"
                  }
                >
                  <SelectTrigger id="lbPolicy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="round_robin">Round Robin</SelectItem>
                    <SelectItem value="least_conn">
                      Least Connections
                    </SelectItem>
                    <SelectItem value="ip_hash">IP Hash</SelectItem>
                    <SelectItem value="first">First Available</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FormField label="Try Duration" htmlFor="lbTryDuration">
                <Input
                  id="lbTryDuration"
                  name="lbTryDuration"
                  placeholder="5s"
                  defaultValue={
                    initialData?.loadBalancer?.tryDuration ?? ""
                  }
                />
              </FormField>
              <FormField label="Try Interval" htmlFor="lbTryInterval">
                <Input
                  id="lbTryInterval"
                  name="lbTryInterval"
                  placeholder="250ms"
                  defaultValue={
                    initialData?.loadBalancer?.tryInterval ?? ""
                  }
                />
              </FormField>
              <FormField label="Retries" htmlFor="lbRetries">
                <Input
                  id="lbRetries"
                  name="lbRetries"
                  type="number"
                  defaultValue={initialData?.loadBalancer?.retries ?? ""}
                />
              </FormField>

              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2">
                Active Health Check
              </p>
              <input
                type="hidden"
                name="lbActiveHealthEnabledPresent"
                value="1"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="lbActiveHealthEnabled"
                  name="lbActiveHealthEnabled"
                  defaultChecked={
                    initialData?.loadBalancer?.activeHealthCheck?.enabled ??
                    false
                  }
                />
                <Label htmlFor="lbActiveHealthEnabled">
                  Enable Active Health Check
                </Label>
              </div>
              <FormField
                label="Health Check Port"
                htmlFor="lbActiveHealthPort"
              >
                <Input
                  id="lbActiveHealthPort"
                  name="lbActiveHealthPort"
                  type="number"
                  defaultValue={
                    initialData?.loadBalancer?.activeHealthCheck?.port ?? ""
                  }
                />
              </FormField>
              <FormField label="Interval" htmlFor="lbActiveHealthInterval">
                <Input
                  id="lbActiveHealthInterval"
                  name="lbActiveHealthInterval"
                  placeholder="30s"
                  defaultValue={
                    initialData?.loadBalancer?.activeHealthCheck?.interval ??
                    ""
                  }
                />
              </FormField>
              <FormField label="Timeout" htmlFor="lbActiveHealthTimeout">
                <Input
                  id="lbActiveHealthTimeout"
                  name="lbActiveHealthTimeout"
                  placeholder="5s"
                  defaultValue={
                    initialData?.loadBalancer?.activeHealthCheck?.timeout ?? ""
                  }
                />
              </FormField>

              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2">
                Passive Health Check
              </p>
              <input
                type="hidden"
                name="lbPassiveHealthEnabledPresent"
                value="1"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="lbPassiveHealthEnabled"
                  name="lbPassiveHealthEnabled"
                  defaultChecked={
                    initialData?.loadBalancer?.passiveHealthCheck?.enabled ??
                    false
                  }
                />
                <Label htmlFor="lbPassiveHealthEnabled">
                  Enable Passive Health Check
                </Label>
              </div>
              <FormField
                label="Fail Duration"
                htmlFor="lbPassiveHealthFailDuration"
              >
                <Input
                  id="lbPassiveHealthFailDuration"
                  name="lbPassiveHealthFailDuration"
                  placeholder="30s"
                  defaultValue={
                    initialData?.loadBalancer?.passiveHealthCheck
                      ?.failDuration ?? ""
                  }
                />
              </FormField>
              <FormField label="Max Fails" htmlFor="lbPassiveHealthMaxFails">
                <Input
                  id="lbPassiveHealthMaxFails"
                  name="lbPassiveHealthMaxFails"
                  type="number"
                  defaultValue={
                    initialData?.loadBalancer?.passiveHealthCheck?.maxFails ??
                    ""
                  }
                />
              </FormField>
              <FormField
                label="Unhealthy Latency"
                htmlFor="lbPassiveHealthUnhealthyLatency"
              >
                <Input
                  id="lbPassiveHealthUnhealthyLatency"
                  name="lbPassiveHealthUnhealthyLatency"
                  placeholder="5s"
                  defaultValue={
                    initialData?.loadBalancer?.passiveHealthCheck
                      ?.unhealthyLatency ?? ""
                  }
                />
              </FormField>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* DNS Resolver */}
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultDnsAccordion}
        className="border-l-2 border-l-emerald-500 border rounded-md px-3"
      >
        <AccordionItem value="dns-resolver" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium hover:no-underline">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
                <Globe className="h-3.5 w-3.5" />
              </div>
              Custom DNS Resolvers
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="dnsPresent" value="1" />
              <input type="hidden" name="dnsEnabledPresent" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="dnsEnabled"
                  name="dnsEnabled"
                  defaultChecked={initialData?.dnsResolver?.enabled ?? false}
                />
                <Label htmlFor="dnsEnabled">Enable Custom DNS</Label>
              </div>
              <FormField
                label="DNS Resolvers"
                htmlFor="dnsResolvers"
                helperText="One per line. Used for upstream hostname resolution."
              >
                <Textarea
                  id="dnsResolvers"
                  name="dnsResolvers"
                  placeholder={"1.1.1.1\n8.8.8.8"}
                  defaultValue={
                    initialData?.dnsResolver?.resolvers?.join("\n") ?? ""
                  }
                  rows={2}
                />
              </FormField>
              <FormField
                label="Fallback Resolvers"
                htmlFor="dnsFallbacks"
                helperText="Fallback DNS servers (one per line)."
              >
                <Textarea
                  id="dnsFallbacks"
                  name="dnsFallbacks"
                  placeholder="8.8.4.4"
                  defaultValue={
                    initialData?.dnsResolver?.fallbacks?.join("\n") ?? ""
                  }
                  rows={1}
                />
              </FormField>
              <FormField label="Timeout" htmlFor="dnsTimeout">
                <Input
                  id="dnsTimeout"
                  name="dnsTimeout"
                  placeholder="5s"
                  defaultValue={initialData?.dnsResolver?.timeout ?? ""}
                />
              </FormField>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Geo Blocking */}
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultGeoblockAccordion}
        className="border-l-2 border-l-rose-500 border rounded-md px-3"
      >
        <AccordionItem value="geoblock" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium hover:no-underline">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded border border-rose-500/30 bg-rose-500/10 text-rose-500">
                <MapPin className="h-3.5 w-3.5" />
              </div>
              Geo Blocking
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="geoblockPresent" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="geoblockEnabled"
                  name="geoblockEnabled"
                  defaultChecked={initialData?.geoblock?.enabled ?? false}
                />
                <Label htmlFor="geoblockEnabled">Enable Geo Blocking</Label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="geoblockMode">Mode</Label>
                <Select
                  name="geoblockMode"
                  defaultValue={initialData?.geoblockMode ?? "merge"}
                >
                  <SelectTrigger id="geoblockMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">
                      Merge with global settings
                    </SelectItem>
                    <SelectItem value="override">
                      Override global settings
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                Block Rules
              </p>
              <FormField
                label="Block Countries"
                htmlFor="geoblockBlockCountries"
                helperText="ISO 3166-1 alpha-2 codes, comma-separated"
              >
                <Input
                  id="geoblockBlockCountries"
                  name="geoblockBlockCountries"
                  placeholder="CN, RU, KP"
                  defaultValue={
                    initialData?.geoblock?.block_countries?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField
                label="Block Continents"
                htmlFor="geoblockBlockContinents"
                helperText="AF, AN, AS, EU, NA, OC, SA"
              >
                <Input
                  id="geoblockBlockContinents"
                  name="geoblockBlockContinents"
                  placeholder="AF, AS"
                  defaultValue={
                    initialData?.geoblock?.block_continents?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block ASNs" htmlFor="geoblockBlockAsns">
                <Input
                  id="geoblockBlockAsns"
                  name="geoblockBlockAsns"
                  placeholder="12345, 67890"
                  defaultValue={
                    initialData?.geoblock?.block_asns?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block CIDRs" htmlFor="geoblockBlockCidrs">
                <Input
                  id="geoblockBlockCidrs"
                  name="geoblockBlockCidrs"
                  placeholder="192.0.2.0/24"
                  defaultValue={
                    initialData?.geoblock?.block_cidrs?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block IPs" htmlFor="geoblockBlockIps">
                <Input
                  id="geoblockBlockIps"
                  name="geoblockBlockIps"
                  placeholder="203.0.113.1"
                  defaultValue={
                    initialData?.geoblock?.block_ips?.join(", ") ?? ""
                  }
                />
              </FormField>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2">
                Allow Rules (override blocks)
              </p>
              <FormField
                label="Allow Countries"
                htmlFor="geoblockAllowCountries"
              >
                <Input
                  id="geoblockAllowCountries"
                  name="geoblockAllowCountries"
                  placeholder="US, DE"
                  defaultValue={
                    initialData?.geoblock?.allow_countries?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField
                label="Allow Continents"
                htmlFor="geoblockAllowContinents"
              >
                <Input
                  id="geoblockAllowContinents"
                  name="geoblockAllowContinents"
                  placeholder="EU, NA"
                  defaultValue={
                    initialData?.geoblock?.allow_continents?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow ASNs" htmlFor="geoblockAllowAsns">
                <Input
                  id="geoblockAllowAsns"
                  name="geoblockAllowAsns"
                  placeholder="11111"
                  defaultValue={
                    initialData?.geoblock?.allow_asns?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow CIDRs" htmlFor="geoblockAllowCidrs">
                <Input
                  id="geoblockAllowCidrs"
                  name="geoblockAllowCidrs"
                  placeholder="10.0.0.0/8"
                  defaultValue={
                    initialData?.geoblock?.allow_cidrs?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow IPs" htmlFor="geoblockAllowIps">
                <Input
                  id="geoblockAllowIps"
                  name="geoblockAllowIps"
                  placeholder="1.2.3.4"
                  defaultValue={
                    initialData?.geoblock?.allow_ips?.join(", ") ?? ""
                  }
                />
              </FormField>
              <Alert className="mt-1">
                <AlertDescription>
                  At L4, geo blocking uses the client&apos;s direct IP address
                  (no X-Forwarded-For support). Blocked connections are
                  immediately closed.
                </AlertDescription>
              </Alert>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Upstream DNS Resolution / Pinning */}
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultUpstreamDnsAccordion}
        className="border-l-2 border-l-violet-500 border rounded-md px-3"
      >
        <AccordionItem value="upstream-dns" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium hover:no-underline">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded border border-violet-500/30 bg-violet-500/10 text-violet-500">
                <Pin className="h-3.5 w-3.5" />
              </div>
              Upstream DNS Pinning
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input
                type="hidden"
                name="upstreamDnsResolutionPresent"
                value="1"
              />
              <p className="text-sm text-muted-foreground">
                When enabled, upstream hostnames are resolved to IP addresses at
                config time, pinning DNS resolution.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="upstreamDnsResolutionMode">
                  Resolution Mode
                </Label>
                <Select
                  name="upstreamDnsResolutionMode"
                  defaultValue={
                    initialData?.upstreamDnsResolution?.enabled === true
                      ? "enabled"
                      : initialData?.upstreamDnsResolution?.enabled === false
                      ? "disabled"
                      : "inherit"
                  }
                >
                  <SelectTrigger id="upstreamDnsResolutionMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      Inherit from global settings
                    </SelectItem>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="upstreamDnsResolutionFamily">
                  Address Family Preference
                </Label>
                <Select
                  name="upstreamDnsResolutionFamily"
                  defaultValue={
                    initialData?.upstreamDnsResolution?.family ?? "inherit"
                  }
                >
                  <SelectTrigger id="upstreamDnsResolutionFamily">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      Inherit from global settings
                    </SelectItem>
                    <SelectItem value="both">Both (IPv6 + IPv4)</SelectItem>
                    <SelectItem value="ipv6">IPv6 only</SelectItem>
                    <SelectItem value="ipv4">IPv4 only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </form>
  );
}

export function CreateL4HostDialog({
  open,
  onClose,
  initialData,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: L4ProxyHost | null;
}) {
  const [state, formAction] = useFormState(
    createL4ProxyHostAction,
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={initialData ? "Duplicate L4 Proxy Host" : "Create L4 Proxy Host"}
      maxWidth="lg"
      submitLabel="Create"
      onSubmit={() => {
        (
          document.getElementById("create-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="create-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={
          initialData ? { ...initialData, name: `${initialData.name} (Copy)` } : null
        }
      />
    </AppDialog>
  );
}

export function EditL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState(
    updateL4ProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Edit L4 Proxy Host"
      maxWidth="lg"
      submitLabel="Save Changes"
      onSubmit={() => {
        (
          document.getElementById("edit-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <L4HostForm
        formId="edit-l4-host-form"
        formAction={formAction}
        state={state}
        initialData={host}
      />
    </AppDialog>
  );
}

export function DeleteL4HostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: L4ProxyHost;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState(
    deleteL4ProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete L4 Proxy Host"
      maxWidth="lg"
      submitLabel="Delete"
      onSubmit={() => {
        (
          document.getElementById("delete-l4-host-form") as HTMLFormElement
        )?.requestSubmit();
      }}
    >
      <form
        id="delete-l4-host-form"
        action={formAction}
        className="flex flex-col gap-4"
      >
        {state.status !== "idle" && state.message && (
          <Alert
            variant={state.status === "error" ? "destructive" : "default"}
          >
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm">
          Are you sure you want to delete the L4 proxy host{" "}
          <strong>{host.name}</strong>?
        </p>
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Protocol</span>
            <Badge variant={host.protocol === "tcp" ? "info" : "warning"} className="text-[10px] px-1.5 py-0">
              {host.protocol.toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Listen</span>
            <span className="font-mono text-xs">{host.listenAddress}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Upstreams</span>
            <span className="font-mono text-xs">{host.upstreams.join(", ")}</span>
          </div>
        </div>
        <p className="text-sm text-destructive font-medium">
          This action cannot be undone.
        </p>
      </form>
    </AppDialog>
  );
}
