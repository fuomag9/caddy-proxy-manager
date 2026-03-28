"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import type { LocationRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: LocationRule[] };

export function LocationRulesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<LocationRule[]>(initialData);

  const addRule = () =>
    setRules((r) => [...r, { path: "", upstreams: [] }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updatePath = (i: number, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, path: value } : rule)));

  const updateUpstreams = (i: number, value: string) =>
    setRules((r) =>
      r.map((rule, idx) =>
        idx === i
          ? {
              ...rule,
              upstreams: value
                .split("\n")
                .map((u) => u.trim())
                .filter(Boolean),
            }
          : rule
      )
    );

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Location Rules</p>
      <input type="hidden" name="location_rules_json" value={JSON.stringify(rules)} />
      {rules.length > 0 && (
        <div className="mb-2 flex flex-col gap-3">
          {rules.map((rule, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_40px] gap-2 items-start">
              <div>
                {i === 0 && (
                  <span className="text-xs font-medium text-muted-foreground px-1 mb-1 block">Path Pattern</span>
                )}
                <Input
                  size={1}
                  placeholder="/ws/*"
                  value={rule.path}
                  onChange={(e) => updatePath(i, e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                {i === 0 && (
                  <span className="text-xs font-medium text-muted-foreground px-1 mb-1 block">Upstreams</span>
                )}
                <Textarea
                  placeholder={"ws-backend:8080\nws-backend2:8080"}
                  value={rule.upstreams.join("\n")}
                  onChange={(e) => updateUpstreams(i, e.target.value)}
                  className="text-sm min-h-[32px]"
                  rows={Math.max(1, rule.upstreams.length)}
                />
              </div>
              <div className={i === 0 ? "mt-5" : ""}>
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
