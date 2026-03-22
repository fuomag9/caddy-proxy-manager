"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { useState } from "react";

type Props = {
  value?: number[];
};

export function WafRuleExclusions({ value }: Props) {
  const [ids, setIds] = useState<number[]>(value ?? []);
  const [inputVal, setInputVal] = useState("");

  function addId() {
    const n = parseInt(inputVal.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (ids.includes(n)) { setInputVal(""); return; }
    setIds((prev) => [...prev, n]);
    setInputVal("");
  }

  function removeId(id: number) {
    setIds((prev) => prev.filter((x) => x !== id));
  }

  return (
    <div>
      <input type="hidden" name="waf_excluded_rule_ids" value={JSON.stringify(ids)} />
      <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
        Excluded Rule IDs
      </span>
      <span className="text-xs text-muted-foreground block mb-2">
        Rules listed here are disabled via <code>SecRuleRemoveById</code>
      </span>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ids.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1 font-mono text-xs">
              {id}
              <button
                type="button"
                onClick={() => removeId(id)}
                className="rounded-full hover:bg-destructive/20 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 max-w-[260px]">
        <Input
          size={1}
          placeholder="Rule ID"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addId(); } }}
          inputMode="numeric"
          pattern="[0-9]*"
          className="flex-1 h-8 text-sm"
        />
        <Button type="button" size="icon" variant="ghost" onClick={addId} className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
