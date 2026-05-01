import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { AuthentikSettings } from "@/lib/settings";
import { ProxyHost } from "@/lib/models/proxy-hosts";

const AUTHENTIK_DEFAULT_HEADERS = [
    "X-Authentik-Username",
    "X-Authentik-Groups",
    "X-Authentik-Entitlements",
    "X-Authentik-Email",
    "X-Authentik-Name",
    "X-Authentik-Uid",
    "X-Authentik-Jwt",
    "X-Authentik-Meta-Jwks",
    "X-Authentik-Meta-Outpost",
    "X-Authentik-Meta-Provider",
    "X-Authentik-Meta-App",
    "X-Authentik-Meta-Version"
];

const AUTHENTIK_DEFAULT_TRUSTED_PROXIES = ["private_ranges"];

function getAuthentikFormDefaults(
    authentik: ProxyHost["authentik"] | null,
    defaults: AuthentikSettings | null | undefined
) {
    return {
        enabled: authentik?.enabled ?? false,
        outpostDomain: authentik?.outpostDomain ?? defaults?.outpostDomain ?? "",
        outpostUpstream: authentik?.outpostUpstream ?? defaults?.outpostUpstream ?? "",
        authEndpoint: authentik?.authEndpoint ?? defaults?.authEndpoint ?? "",
        copyHeaders:
            authentik && authentik.copyHeaders.length > 0
                ? authentik.copyHeaders.join("\n")
                : AUTHENTIK_DEFAULT_HEADERS.join("\n"),
        trustedProxies:
            authentik && authentik.trustedProxies.length > 0
                ? authentik.trustedProxies.join("\n")
                : AUTHENTIK_DEFAULT_TRUSTED_PROXIES.join("\n"),
        setHostHeader: authentik?.setOutpostHostHeader ?? true
    };
}

function HiddenCheckboxField({
    name,
    defaultChecked,
    label,
    disabled,
    helperText
}: {
    name: string;
    defaultChecked: boolean;
    label: string;
    disabled?: boolean;
    helperText?: string;
}) {
    return (
        <div>
            <input type="hidden" name={`${name}Present`} value="1" />
            <div className={cn("flex items-start gap-2", disabled && "opacity-50")}>
                <Checkbox
                    id={`checkbox-${name}`}
                    name={name}
                    defaultChecked={defaultChecked}
                    disabled={disabled}
                />
                <label
                    htmlFor={`checkbox-${name}`}
                    className={cn("text-sm cursor-pointer", disabled && "cursor-not-allowed")}
                >
                    {label}
                </label>
            </div>
            {helperText && (
                <p className="text-xs text-muted-foreground ml-6 -mt-0.5">
                    {helperText}
                </p>
            )}
        </div>
    );
}

export function AuthentikFields({
    authentik,
    defaults
}: {
    authentik?: ProxyHost["authentik"] | null;
    defaults?: AuthentikSettings | null;
}) {
    const initial = authentik ?? null;
    const [enabled, setEnabled] = useState(false);
    const [outpostDomain, setOutpostDomain] = useState("");
    const [outpostUpstream, setOutpostUpstream] = useState("");
    const [authEndpoint, setAuthEndpoint] = useState("");
    const [copyHeadersValue, setCopyHeadersValue] = useState("");
    const [trustedProxiesValue, setTrustedProxiesValue] = useState("");
    const [setHostHeaderDefault, setSetHostHeaderDefault] = useState(true);

    useEffect(() => {
        const next = getAuthentikFormDefaults(initial, defaults);
        setEnabled(next.enabled);
        setOutpostDomain(next.outpostDomain);
        setOutpostUpstream(next.outpostUpstream);
        setAuthEndpoint(next.authEndpoint);
        setCopyHeadersValue(next.copyHeaders);
        setTrustedProxiesValue(next.trustedProxies);
        setSetHostHeaderDefault(next.setHostHeader);
    }, [initial, defaults]);

    return (
        <div className="rounded-lg border border-primary bg-primary/5 p-5">
            <input type="hidden" name="authentikPresent" value="1" />
            <input type="hidden" name="authentikEnabledPresent" value="1" />
            <input type="hidden" name="authentikEnabled" value={enabled ? "true" : "false"} />
            <div className="flex flex-col gap-4">
                <div className="flex flex-row items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold">Authentik Forward Auth</p>
                        <p className="text-sm text-muted-foreground">Proxy authentication via Authentik outpost</p>
                    </div>
                    <Switch
                        checked={enabled}
                        onCheckedChange={setEnabled}
                    />
                </div>

                <div className={cn(
                    "overflow-hidden transition-all duration-200",
                    enabled ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                )}>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">Outpost Domain</label>
                            <Input
                                name="authentikOutpostDomain"
                                placeholder="outpost.goauthentik.io"
                                value={outpostDomain}
                                onChange={(event) => setOutpostDomain(event.target.value)}
                                required={enabled}
                                disabled={!enabled}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Outpost Upstream URL</label>
                            <Input
                                name="authentikOutpostUpstream"
                                placeholder="https://outpost.internal:9000"
                                value={outpostUpstream}
                                onChange={(event) => setOutpostUpstream(event.target.value)}
                                required={enabled}
                                disabled={!enabled}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Auth Endpoint (Optional)</label>
                            <Input
                                name="authentikAuthEndpoint"
                                placeholder="/outpost.goauthentik.io/auth/caddy"
                                value={authEndpoint}
                                onChange={(event) => setAuthEndpoint(event.target.value)}
                                disabled={!enabled}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Headers to Copy</label>
                            <Textarea
                                name="authentikCopyHeaders"
                                value={copyHeadersValue}
                                onChange={(event) => setCopyHeadersValue(event.target.value)}
                                disabled={!enabled}
                                rows={3}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Trusted Proxies</label>
                            <Input
                                name="authentikTrustedProxies"
                                value={trustedProxiesValue}
                                onChange={(event) => setTrustedProxiesValue(event.target.value)}
                                disabled={!enabled}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Protected Paths (Optional)</label>
                            <Textarea
                                name="authentikProtectedPaths"
                                placeholder="/secret/*, /admin/*"
                                defaultValue={initial?.protectedPaths?.join(", ") ?? ""}
                                disabled={!enabled}
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Leave empty to protect entire domain. Specify paths to protect specific routes only.
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Excluded Paths (Optional)</label>
                            <Textarea
                                name="authentikExcludedPaths"
                                placeholder="/share/*, /rest/*"
                                defaultValue={initial?.excludedPaths?.join(", ") ?? ""}
                                disabled={!enabled}
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Paths to exclude from authentication. These paths will bypass forward auth while all other paths remain protected. Ignored if Protected Paths is set.
                            </p>
                        </div>
                        <HiddenCheckboxField
                            name="authentikSetHostHeader"
                            defaultChecked={setHostHeaderDefault}
                            label="Set Host Header for Outpost"
                            disabled={!enabled}
                            helperText="Recommended: Keep enabled. Only disable if using IP-based outpost access or troubleshooting routing issues."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
