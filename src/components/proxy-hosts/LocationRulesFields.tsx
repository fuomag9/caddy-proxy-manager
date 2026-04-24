"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, MinusCircle } from "lucide-react";
import type { LocationRule } from "@/lib/models/proxy-hosts";

type UpstreamEntry = { protocol: string; address: string };

function parseUpstream(upstream: string): UpstreamEntry {
  if (upstream.startsWith("https://")) return { protocol: "https://", address: upstream.slice(8) };
  if (upstream.startsWith("http://")) return { protocol: "http://", address: upstream.slice(7) };
  return { protocol: "http://", address: upstream };
}

function serializeUpstream(entry: UpstreamEntry): string {
  return `${entry.protocol}${entry.address.trim()}`;
}

type RuleState = { path: string; upstreams: UpstreamEntry[] };

function toState(rules: LocationRule[]): RuleState[] {
  return rules.map((r) => ({
    path: r.path,
    upstreams: r.upstreams.length > 0 ? r.upstreams.map(parseUpstream) : [{ protocol: "http://", address: "" }],
  }));
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.path.trim())
      .map((r) => ({
        path: r.path.trim(),
        upstreams: r.upstreams
          .filter((u) => u.address.trim())
          .map(serializeUpstream),
      }))
      .filter((r) => r.upstreams.length > 0)
  );
}

type Props = { initialData?: LocationRule[] };

export function LocationRulesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RuleState[]>(toState(initialData));

  const addRule = () =>
    setRules((r) => [...r, { path: "", upstreams: [{ protocol: "http://", address: "" }] }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updatePath = (i: number, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, path: value } : rule)));

  const addUpstream = (ruleIdx: number) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx
          ? { ...rule, upstreams: [...rule.upstreams, { protocol: "http://", address: "" }] }
          : rule
      )
    );

  const removeUpstream = (ruleIdx: number, upIdx: number) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx && rule.upstreams.length > 1
          ? { ...rule, upstreams: rule.upstreams.filter((_, i) => i !== upIdx) }
          : rule
      )
    );

  const updateUpstreamProtocol = (ruleIdx: number, upIdx: number, protocol: string) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === ruleIdx
          ? {
              ...rule,
              upstreams: rule.upstreams.map((u, i) => (i === upIdx ? { ...u, protocol } : u)),
            }
          : rule
      )
    );

  const updateUpstreamAddress = (ruleIdx: number, upIdx: number, address: string) =>
    setRules((r) =>
      r.map((rule, idx) => {
        if (idx !== ruleIdx) return rule;
        return {
          ...rule,
          upstreams: rule.upstreams.map((u, i) => {
            if (i !== upIdx) return u;
            if (address.startsWith("https://")) return { protocol: "https://", address: address.slice(8) };
            if (address.startsWith("http://")) return { protocol: "http://", address: address.slice(7) };
            return { ...u, address };
          }),
        };
      })
    );

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Location Rules</p>
      <input type="hidden" name="locationRulesJson" value={toJson(rules)} />
      {rules.length > 0 && (
        <div className="mb-2 flex flex-col gap-4">
          {rules.map((rule, i) => (
            <div key={i} className="rounded-md border p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <span className="text-xs font-medium text-muted-foreground px-1 mb-1 block">Path Pattern</span>
                  <Input
                    size={1}
                    placeholder="/ws/*"
                    value={rule.path}
                    onChange={(e) => updatePath(i, e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="self-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => removeRule(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground px-1 mb-1 block">Upstreams</span>
                <div className="flex flex-col gap-2">
                  {rule.upstreams.map((up, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <Select value={up.protocol} onValueChange={(val) => updateUpstreamProtocol(i, j, val)}>
                        <SelectTrigger className="w-28 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http://">http://</SelectItem>
                          <SelectItem value="https://">https://</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={up.address}
                        onChange={(e) => updateUpstreamAddress(i, j, e.target.value)}
                        placeholder="10.0.0.5:8080"
                        className="flex-1 h-8 text-sm"
                      />
                      <span title={rule.upstreams.length === 1 ? "At least one upstream required" : "Remove upstream"}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeUpstream(i, j)}
                          disabled={rule.upstreams.length === 1}
                        >
                          <MinusCircle className="h-4 w-4" />
                        </Button>
                      </span>
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => addUpstream(i)} className="self-start">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Upstream
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={addRule}>
        <Plus className="h-4 w-4 mr-1" />
        Add Location Rule
      </Button>
    </div>
  );
}
