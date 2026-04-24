"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import type { RedirectRule } from "@/lib/models/proxy-hosts";

type Props = { initialData?: RedirectRule[] };

export function RedirectsFields({ initialData = [] }: Props) {
  const [rules, setRules] = useState<RedirectRule[]>(initialData);

  const addRule = () =>
    setRules((r) => [...r, { from: "", to: "", status: 301 }]);

  const removeRule = (i: number) =>
    setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, key: keyof RedirectRule, value: string | number) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Redirects</p>
      <input type="hidden" name="redirectsJson" value={JSON.stringify(rules)} />
      {rules.length > 0 && (
        <div className="mb-2">
          <div className="grid grid-cols-[1fr_1fr_90px_40px] gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground px-1">From Path</span>
            <span className="text-xs font-medium text-muted-foreground px-1">To URL / Path</span>
            <span className="text-xs font-medium text-muted-foreground px-1">Status</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_40px] gap-2 items-center">
                <Input
                  size={1}
                  placeholder="/.well-known/carddav"
                  value={rule.from}
                  onChange={(e) => updateRule(i, "from", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  size={1}
                  placeholder="/remote.php/dav/"
                  value={rule.to}
                  onChange={(e) => updateRule(i, "to", e.target.value)}
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
                    {[301, 302, 307, 308].map((s) => (
                      <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
        Add Redirect
      </Button>
    </div>
  );
}
