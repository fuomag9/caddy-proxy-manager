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
  const [protocol, setProtocol] = useState(initialData?.protocol ?? "tcp");
  const [matcherType, setMatcherType] = useState(
    initialData?.matcher_type ?? "none"
  );

  const defaultLbAccordion = initialData?.load_balancer?.enabled
    ? "load-balancer"
    : undefined;
  const defaultDnsAccordion = initialData?.dns_resolver?.enabled
    ? "dns-resolver"
    : undefined;
  const defaultGeoblockAccordion = initialData?.geoblock?.enabled
    ? "geoblock"
    : undefined;
  const defaultUpstreamDnsAccordion =
    initialData?.upstream_dns_resolution?.enabled === true
      ? "upstream-dns"
      : undefined;

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-5">
      {state.status !== "idle" && state.message && (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="enabled_present" value="1" />
      <div className="flex items-center gap-2">
        <Switch
          id="enabled"
          name="enabled"
          defaultChecked={initialData?.enabled ?? true}
        />
        <Label htmlFor="enabled">Enabled</Label>
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
            <SelectItem value="tcp">TCP</SelectItem>
            <SelectItem value="udp">UDP</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <FormField
        label="Listen Address"
        htmlFor="listen_address"
        helperText="Format: :PORT or HOST:PORT. Make sure to expose this port in docker-compose.yml on the caddy service."
      >
        <Input
          id="listen_address"
          name="listen_address"
          placeholder=":5432"
          defaultValue={initialData?.listen_address ?? ""}
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
        <Label htmlFor="matcher_type">Matcher</Label>
        <Select
          name="matcher_type"
          value={matcherType}
          onValueChange={(v) =>
            setMatcherType(
              v as "none" | "tls_sni" | "http_host" | "proxy_protocol"
            )
          }
        >
          <SelectTrigger id="matcher_type">
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
          htmlFor="matcher_value"
          helperText="Comma-separated list of hostnames to match."
        >
          <Input
            id="matcher_value"
            name="matcher_value"
            placeholder="db.example.com, api.example.com"
            defaultValue={initialData?.matcher_value?.join(", ") ?? ""}
            required
          />
        </FormField>
      )}

      {protocol === "tcp" && (
        <div className="flex items-center gap-2">
          <Switch
            id="tls_termination"
            name="tls_termination"
            defaultChecked={initialData?.tls_termination ?? false}
          />
          <Label htmlFor="tls_termination">TLS Termination</Label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="proxy_protocol_receive"
          name="proxy_protocol_receive"
          defaultChecked={initialData?.proxy_protocol_receive ?? false}
        />
        <Label htmlFor="proxy_protocol_receive">
          Accept inbound PROXY protocol
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proxy_protocol_version">
          Send PROXY protocol to upstream
        </Label>
        <Select
          name="proxy_protocol_version"
          defaultValue={initialData?.proxy_protocol_version ?? ""}
        >
          <SelectTrigger id="proxy_protocol_version">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None</SelectItem>
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
        className="border rounded-md px-3"
      >
        <AccordionItem value="load-balancer" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium">
            Load Balancer
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="lb_present" value="1" />
              <input type="hidden" name="lb_enabled_present" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="lb_enabled"
                  name="lb_enabled"
                  defaultChecked={
                    initialData?.load_balancer?.enabled ?? false
                  }
                />
                <Label htmlFor="lb_enabled">Enable Load Balancing</Label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb_policy">Policy</Label>
                <Select
                  name="lb_policy"
                  defaultValue={
                    initialData?.load_balancer?.policy ?? "random"
                  }
                >
                  <SelectTrigger id="lb_policy">
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
              <FormField label="Try Duration" htmlFor="lb_try_duration">
                <Input
                  id="lb_try_duration"
                  name="lb_try_duration"
                  placeholder="5s"
                  defaultValue={
                    initialData?.load_balancer?.tryDuration ?? ""
                  }
                />
              </FormField>
              <FormField label="Try Interval" htmlFor="lb_try_interval">
                <Input
                  id="lb_try_interval"
                  name="lb_try_interval"
                  placeholder="250ms"
                  defaultValue={
                    initialData?.load_balancer?.tryInterval ?? ""
                  }
                />
              </FormField>
              <FormField label="Retries" htmlFor="lb_retries">
                <Input
                  id="lb_retries"
                  name="lb_retries"
                  type="number"
                  defaultValue={initialData?.load_balancer?.retries ?? ""}
                />
              </FormField>

              <p className="text-xs text-muted-foreground font-medium mt-1">
                Active Health Check
              </p>
              <input
                type="hidden"
                name="lb_active_health_enabled_present"
                value="1"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="lb_active_health_enabled"
                  name="lb_active_health_enabled"
                  defaultChecked={
                    initialData?.load_balancer?.activeHealthCheck?.enabled ??
                    false
                  }
                />
                <Label htmlFor="lb_active_health_enabled">
                  Enable Active Health Check
                </Label>
              </div>
              <FormField
                label="Health Check Port"
                htmlFor="lb_active_health_port"
              >
                <Input
                  id="lb_active_health_port"
                  name="lb_active_health_port"
                  type="number"
                  defaultValue={
                    initialData?.load_balancer?.activeHealthCheck?.port ?? ""
                  }
                />
              </FormField>
              <FormField label="Interval" htmlFor="lb_active_health_interval">
                <Input
                  id="lb_active_health_interval"
                  name="lb_active_health_interval"
                  placeholder="30s"
                  defaultValue={
                    initialData?.load_balancer?.activeHealthCheck?.interval ??
                    ""
                  }
                />
              </FormField>
              <FormField label="Timeout" htmlFor="lb_active_health_timeout">
                <Input
                  id="lb_active_health_timeout"
                  name="lb_active_health_timeout"
                  placeholder="5s"
                  defaultValue={
                    initialData?.load_balancer?.activeHealthCheck?.timeout ?? ""
                  }
                />
              </FormField>

              <p className="text-xs text-muted-foreground font-medium mt-1">
                Passive Health Check
              </p>
              <input
                type="hidden"
                name="lb_passive_health_enabled_present"
                value="1"
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="lb_passive_health_enabled"
                  name="lb_passive_health_enabled"
                  defaultChecked={
                    initialData?.load_balancer?.passiveHealthCheck?.enabled ??
                    false
                  }
                />
                <Label htmlFor="lb_passive_health_enabled">
                  Enable Passive Health Check
                </Label>
              </div>
              <FormField
                label="Fail Duration"
                htmlFor="lb_passive_health_fail_duration"
              >
                <Input
                  id="lb_passive_health_fail_duration"
                  name="lb_passive_health_fail_duration"
                  placeholder="30s"
                  defaultValue={
                    initialData?.load_balancer?.passiveHealthCheck
                      ?.failDuration ?? ""
                  }
                />
              </FormField>
              <FormField label="Max Fails" htmlFor="lb_passive_health_max_fails">
                <Input
                  id="lb_passive_health_max_fails"
                  name="lb_passive_health_max_fails"
                  type="number"
                  defaultValue={
                    initialData?.load_balancer?.passiveHealthCheck?.maxFails ??
                    ""
                  }
                />
              </FormField>
              <FormField
                label="Unhealthy Latency"
                htmlFor="lb_passive_health_unhealthy_latency"
              >
                <Input
                  id="lb_passive_health_unhealthy_latency"
                  name="lb_passive_health_unhealthy_latency"
                  placeholder="5s"
                  defaultValue={
                    initialData?.load_balancer?.passiveHealthCheck
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
        className="border rounded-md px-3"
      >
        <AccordionItem value="dns-resolver" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium">
            Custom DNS Resolvers
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="dns_present" value="1" />
              <input type="hidden" name="dns_enabled_present" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="dns_enabled"
                  name="dns_enabled"
                  defaultChecked={initialData?.dns_resolver?.enabled ?? false}
                />
                <Label htmlFor="dns_enabled">Enable Custom DNS</Label>
              </div>
              <FormField
                label="DNS Resolvers"
                htmlFor="dns_resolvers"
                helperText="One per line. Used for upstream hostname resolution."
              >
                <Textarea
                  id="dns_resolvers"
                  name="dns_resolvers"
                  placeholder={"1.1.1.1\n8.8.8.8"}
                  defaultValue={
                    initialData?.dns_resolver?.resolvers?.join("\n") ?? ""
                  }
                  rows={2}
                />
              </FormField>
              <FormField
                label="Fallback Resolvers"
                htmlFor="dns_fallbacks"
                helperText="Fallback DNS servers (one per line)."
              >
                <Textarea
                  id="dns_fallbacks"
                  name="dns_fallbacks"
                  placeholder="8.8.4.4"
                  defaultValue={
                    initialData?.dns_resolver?.fallbacks?.join("\n") ?? ""
                  }
                  rows={1}
                />
              </FormField>
              <FormField label="Timeout" htmlFor="dns_timeout">
                <Input
                  id="dns_timeout"
                  name="dns_timeout"
                  placeholder="5s"
                  defaultValue={initialData?.dns_resolver?.timeout ?? ""}
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
        className="border rounded-md px-3"
      >
        <AccordionItem value="geoblock" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium">
            Geo Blocking
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input type="hidden" name="geoblock_present" value="1" />
              <div className="flex items-center gap-2">
                <Switch
                  id="geoblock_enabled"
                  name="geoblock_enabled"
                  defaultChecked={initialData?.geoblock?.enabled ?? false}
                />
                <Label htmlFor="geoblock_enabled">Enable Geo Blocking</Label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="geoblock_mode">Mode</Label>
                <Select
                  name="geoblock_mode"
                  defaultValue={initialData?.geoblock_mode ?? "merge"}
                >
                  <SelectTrigger id="geoblock_mode">
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
              <p className="text-xs text-muted-foreground font-medium">
                Block Rules
              </p>
              <FormField
                label="Block Countries"
                htmlFor="geoblock_block_countries"
                helperText="ISO 3166-1 alpha-2 codes, comma-separated"
              >
                <Input
                  id="geoblock_block_countries"
                  name="geoblock_block_countries"
                  placeholder="CN, RU, KP"
                  defaultValue={
                    initialData?.geoblock?.block_countries?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField
                label="Block Continents"
                htmlFor="geoblock_block_continents"
                helperText="AF, AN, AS, EU, NA, OC, SA"
              >
                <Input
                  id="geoblock_block_continents"
                  name="geoblock_block_continents"
                  placeholder="AF, AS"
                  defaultValue={
                    initialData?.geoblock?.block_continents?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block ASNs" htmlFor="geoblock_block_asns">
                <Input
                  id="geoblock_block_asns"
                  name="geoblock_block_asns"
                  placeholder="12345, 67890"
                  defaultValue={
                    initialData?.geoblock?.block_asns?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block CIDRs" htmlFor="geoblock_block_cidrs">
                <Input
                  id="geoblock_block_cidrs"
                  name="geoblock_block_cidrs"
                  placeholder="192.0.2.0/24"
                  defaultValue={
                    initialData?.geoblock?.block_cidrs?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Block IPs" htmlFor="geoblock_block_ips">
                <Input
                  id="geoblock_block_ips"
                  name="geoblock_block_ips"
                  placeholder="203.0.113.1"
                  defaultValue={
                    initialData?.geoblock?.block_ips?.join(", ") ?? ""
                  }
                />
              </FormField>
              <p className="text-xs text-muted-foreground font-medium">
                Allow Rules (override blocks)
              </p>
              <FormField
                label="Allow Countries"
                htmlFor="geoblock_allow_countries"
              >
                <Input
                  id="geoblock_allow_countries"
                  name="geoblock_allow_countries"
                  placeholder="US, DE"
                  defaultValue={
                    initialData?.geoblock?.allow_countries?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField
                label="Allow Continents"
                htmlFor="geoblock_allow_continents"
              >
                <Input
                  id="geoblock_allow_continents"
                  name="geoblock_allow_continents"
                  placeholder="EU, NA"
                  defaultValue={
                    initialData?.geoblock?.allow_continents?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow ASNs" htmlFor="geoblock_allow_asns">
                <Input
                  id="geoblock_allow_asns"
                  name="geoblock_allow_asns"
                  placeholder="11111"
                  defaultValue={
                    initialData?.geoblock?.allow_asns?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow CIDRs" htmlFor="geoblock_allow_cidrs">
                <Input
                  id="geoblock_allow_cidrs"
                  name="geoblock_allow_cidrs"
                  placeholder="10.0.0.0/8"
                  defaultValue={
                    initialData?.geoblock?.allow_cidrs?.join(", ") ?? ""
                  }
                />
              </FormField>
              <FormField label="Allow IPs" htmlFor="geoblock_allow_ips">
                <Input
                  id="geoblock_allow_ips"
                  name="geoblock_allow_ips"
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
        className="border rounded-md px-3"
      >
        <AccordionItem value="upstream-dns" className="border-b-0">
          <AccordionTrigger className="text-sm font-medium">
            Upstream DNS Pinning
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <input
                type="hidden"
                name="upstream_dns_resolution_present"
                value="1"
              />
              <p className="text-sm text-muted-foreground">
                When enabled, upstream hostnames are resolved to IP addresses at
                config time, pinning DNS resolution.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="upstream_dns_resolution_mode">
                  Resolution Mode
                </Label>
                <Select
                  name="upstream_dns_resolution_mode"
                  defaultValue={
                    initialData?.upstream_dns_resolution?.enabled === true
                      ? "enabled"
                      : initialData?.upstream_dns_resolution?.enabled === false
                      ? "disabled"
                      : "inherit"
                  }
                >
                  <SelectTrigger id="upstream_dns_resolution_mode">
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
                <Label htmlFor="upstream_dns_resolution_family">
                  Address Family Preference
                </Label>
                <Select
                  name="upstream_dns_resolution_family"
                  defaultValue={
                    initialData?.upstream_dns_resolution?.family ?? "inherit"
                  }
                >
                  <SelectTrigger id="upstream_dns_resolution_family">
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
      maxWidth="sm"
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
      maxWidth="sm"
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
      maxWidth="sm"
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
        <p className="text-sm text-muted-foreground">
          This will remove the configuration for:
        </p>
        <div className="pl-4 flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            &bull; Protocol: {host.protocol.toUpperCase()}
          </p>
          <p className="text-sm text-muted-foreground">
            &bull; Listen: {host.listen_address}
          </p>
          <p className="text-sm text-muted-foreground">
            &bull; Upstreams: {host.upstreams.join(", ")}
          </p>
        </div>
        <p className="text-sm text-destructive font-medium">
          This action cannot be undone.
        </p>
      </form>
    </AppDialog>
  );
}
