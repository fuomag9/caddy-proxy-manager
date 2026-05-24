"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import type { PathAllowRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: PathAllowRule[] };

export function PathAllowsFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<PathAllowRule[]>(initialData);

  const addRule = () => setRules((r) => [...r, { path: "" }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { path: value } : rule)));

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Path Allows</p>
      <input
        type="hidden"
        name="pathAllowsJson"
        value={JSON.stringify(rules.filter((r) => r.path.trim()))}
      />
      {rules.length > 0 && (
        <div className="mb-2">
          <div className="grid grid-cols-[1fr_40px] gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground px-1">Path</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div key={i} className="grid grid-cols-[1fr_40px] gap-2 items-center">
                <Input
                  size={1}
                  placeholder="/secret"
                  value={rule.path}
                  onChange={(e) => updateRule(i, e.target.value)}
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
        Add Path Allow
      </Button>
      <p className="text-xs text-muted-foreground mt-1">
        Paths that bypass any matching Path Block and reach the upstream. Allows are folded into
        every block&apos;s matcher: a block fires only for requests that match its pattern and do
        not match any allow. Example: allow <code>/secret</code> + block <code>/*</code> means
        only <code>/secret</code> reaches the upstream; everything else returns the block status.
        Allows do not affect Path Rewrites.
      </p>
    </div>
  );
}
