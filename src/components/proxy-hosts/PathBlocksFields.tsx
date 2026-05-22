"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import type { PathBlockRule, PathBlockStatusCode } from "@/lib/models/proxy-hosts";

// Mirrors PATH_BLOCK_STATUS_CODES in src/lib/models/proxy-hosts.ts. Kept inline so this
// client component does not pull the server-only model module into the bundle.
const STATUS_CODES: readonly PathBlockStatusCode[] = [400, 401, 403, 404, 410, 418, 451, 500, 502, 503];

type RuleState = { path: string; status: PathBlockStatusCode; body: string };

function toState(rules: PathBlockRule[]): RuleState[] {
  return rules.map((r) => ({ path: r.path, status: r.status, body: r.body ?? "" }));
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.path.trim())
      .map((r) => {
        const out: PathBlockRule = { path: r.path.trim(), status: r.status };
        if (r.body.trim()) out.body = r.body;
        return out;
      })
  );
}

type Props = { initialData?: PathBlockRule[] };

export function PathBlocksFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RuleState[]>(toState(initialData));

  const addRule = () =>
    setRules((r) => [...r, { path: "", status: 403, body: "Forbidden" }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, key: keyof RuleState, value: string | number) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Path Blocks</p>
      <input type="hidden" name="pathBlocksJson" value={toJson(rules)} />
      {rules.length > 0 && (
        <div className="mb-2">
          <div className="grid grid-cols-[1fr_100px_1fr_40px] gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground px-1">Path</span>
            <span className="text-xs font-medium text-muted-foreground px-1">Status</span>
            <span className="text-xs font-medium text-muted-foreground px-1">Body (optional)</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_1fr_40px] gap-2 items-center">
                <Input
                  size={1}
                  placeholder="/dns-query"
                  value={rule.path}
                  onChange={(e) => updateRule(i, "path", e.target.value)}
                  className="h-8 text-sm"
                />
                <Select
                  value={String(rule.status)}
                  onValueChange={(v) => updateRule(i, "status", Number(v))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_CODES.map((s) => (
                      <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  size={1}
                  placeholder="Forbidden"
                  value={rule.body}
                  onChange={(e) => updateRule(i, "body", e.target.value)}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => removeRule(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={addRule}>
        <Plus className="h-4 w-4 mr-1" />
        Add Path Block
      </Button>
      <p className="text-xs text-muted-foreground mt-1">
        Return a static response (no proxying) for matching paths. Supports Caddy path patterns like /dns-query or /admin/*.
      </p>
    </div>
  );
}
