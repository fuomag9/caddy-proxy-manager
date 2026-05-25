"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import type { ErrorPageRule } from "@/lib/models/proxy-hosts";

type RuleState = { statuses: string; body: string; contentType: string };

function toState(rules: ErrorPageRule[]): RuleState[] {
  return rules.map((r) => ({
    statuses: r.statuses.join(", "),
    body: r.body,
    contentType: r.contentType ?? "",
  }));
}

function parseStatuses(value: string): number[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => parseInt(part.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 400 && n <= 599)
    ),
  ];
}

function toJson(rules: RuleState[]): string {
  return JSON.stringify(
    rules
      .filter((r) => r.body.trim())
      .map((r) => {
        const out: ErrorPageRule = { statuses: parseStatuses(r.statuses), body: r.body };
        if (r.contentType.trim()) out.contentType = r.contentType.trim();
        return out;
      })
  );
}

type Props = {
  initialData?: ErrorPageRule[];
  // The form field name to emit. Lets the same editor back the per-host form and
  // the global settings form.
  name?: string;
};

export function ErrorPagesFields({ initialData = [], name = "errorPagesJson" }: Props) {
  const [rules, setRules] = useState<RuleState[]>(toState(initialData));

  const addRule = () =>
    setRules((r) => [...r, { statuses: "502, 503, 504", body: "<h1>Service temporarily unavailable</h1>", contentType: "" }]);

  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));

  const updateRule = (i: number, key: keyof RuleState, value: string) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [key]: value } : rule)));

  return (
    <div>
      <p className="text-sm font-semibold mb-2">Error Pages</p>
      <input type="hidden" name={name} value={toJson(rules)} />
      {rules.length > 0 && (
        <div className="mb-2 flex flex-col gap-3">
          {rules.map((rule, i) => (
            <div key={i} className="rounded-md border p-3 flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center">
                <Input
                  size={1}
                  placeholder="502, 503, 504 (blank = all errors)"
                  value={rule.statuses}
                  onChange={(e) => updateRule(i, "statuses", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  size={1}
                  placeholder="text/html; charset=utf-8"
                  value={rule.contentType}
                  onChange={(e) => updateRule(i, "contentType", e.target.value)}
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
              <Textarea
                placeholder="<h1>Service temporarily unavailable</h1>"
                value={rule.body}
                onChange={(e) => updateRule(i, "body", e.target.value)}
                className="text-sm font-mono min-h-20"
              />
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={addRule}>
        <Plus className="h-4 w-4 mr-1" />
        Add Error Page
      </Button>
      <p className="text-xs text-muted-foreground mt-1">
        Serve a custom response body when a request errors (e.g. 502/503 when the upstream is down, or 404).
        Comma-separate status codes, or leave blank to match every error. The original status code is preserved.
      </p>
    </div>
  );
}
