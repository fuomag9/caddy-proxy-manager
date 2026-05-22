"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import type { PathRewriteRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: PathRewriteRule[] };

export function PathRewritesFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<PathRewriteRule[]>(initialData);

  const addRule = () =>
    setRules((r) => [...r, { from: "", to: "" }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, key: keyof PathRewriteRule, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Path Rewrites</p>
      <input type="hidden" name="pathRewritesJson" value={JSON.stringify(rules)} />
      {rules.length > 0 && (
        <div className="mb-2">
          <div className="grid grid-cols-[1fr_1fr_40px] gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground px-1">From Path</span>
            <span className="text-xs font-medium text-muted-foreground px-1">Internal Target URI</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center">
                <Input
                  size={1}
                  placeholder="/secretpath"
                  value={rule.from}
                  onChange={(e) => updateRule(i, "from", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  size={1}
                  placeholder="/dns-query"
                  value={rule.to}
                  onChange={(e) => updateRule(i, "to", e.target.value)}
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
        Add Path Rewrite
      </Button>
      <p className="text-xs text-muted-foreground mt-1">
        Internally rewrite the request URI before proxying. The client URL is unchanged; the upstream sees the target URI.
      </p>
    </div>
  );
}
