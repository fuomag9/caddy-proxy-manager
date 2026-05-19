"use client";

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ArrowRight, Check, FileUp, X, XCircle, AlertTriangle } from "lucide-react";
import { parseProxyHostsImport, type ImportResult, type ProxyHostImportDraft } from "@/lib/proxy-hosts-import";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import {
  importProxyHostsAction,
  type ImportProxyHostsResult,
} from "./actions";

type Step = "input" | "preview" | "result";

const MAX_BYTES = 1_000_000;
const PLACEHOLDER = `example.com {
    reverse_proxy 10.0.0.1:8080
}

other.example.com {
    reverse_proxy 10.0.0.1:9090
}`;

export function ImportProxyHostsDialog({
  open,
  onClose,
  existingHosts,
}: {
  open: boolean;
  onClose: () => void;
  existingHosts: ProxyHost[];
}) {
  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportProxyHostsResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed: ImportResult = useMemo(
    () => parseProxyHostsImport(rawText),
    [rawText]
  );

  const existingDomains = useMemo(() => {
    const set = new Set<string>();
    for (const host of existingHosts) {
      for (const d of host.domains) set.add(d.toLowerCase());
    }
    return set;
  }, [existingHosts]);

  const previewRows = useMemo(() => {
    return parsed.drafts.map((draft) => {
      const conflict = draft.domains.find((d) =>
        existingDomains.has(d.toLowerCase())
      );
      return {
        draft,
        status: conflict ? ("skip" as const) : ("new" as const),
        conflictDomain: conflict,
      };
    });
  }, [parsed.drafts, existingDomains]);

  const newCount = previewRows.filter((r) => r.status === "new").length;
  const skipCount = previewRows.filter((r) => r.status === "skip").length;

  function handleClose() {
    setStep("input");
    setRawText("");
    setResult(null);
    setErrorMessage(null);
    setSubmitting(false);
    onClose();
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErrorMessage(`File too large (${file.size} > ${MAX_BYTES} bytes).`);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result ?? ""));
      setErrorMessage(null);
    };
    reader.onerror = () => setErrorMessage("Failed to read file.");
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleImport() {
    setSubmitting(true);
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("rawText", rawText);
    const response = await importProxyHostsAction(undefined, formData);
    setSubmitting(false);
    if (response.status === "error") {
      setErrorMessage(response.message ?? "Import failed.");
      return;
    }
    setResult(response.result ?? { format: parsed.format, created: [], skipped: [], errors: [] });
    setStep("result");
  }

  const canPreview =
    rawText.trim().length > 0 &&
    (parsed.drafts.length > 0 ||
      parsed.errors.length > 0 ||
      parsed.skipped.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import proxy hosts</DialogTitle>
          <DialogDescription>
            Paste a minimal Caddyfile or a Caddy runtime JSON config (e.g. from <code>curl localhost:2019/config/</code>). The format is auto-detected. The preview detects domain conflicts against the current page; the server performs the final authoritative check.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {step === "input" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="caddyfile-input">Caddyfile content</Label>
              <Textarea
                id="caddyfile-input"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={14}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Detected format: {parsed.format === "caddy-json" ? "Caddy JSON" : "Caddyfile"}.{" "}
                {parsed.drafts.length} host(s) · {parsed.errors.length} error(s)
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".caddyfile,.conf,.json,.txt,application/json,text/plain"
                className="hidden"
                aria-label="Load Caddyfile from file"
                onChange={handleFile}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                Load from file
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <PreviewStep
            rows={previewRows}
            errors={parsed.errors}
            newCount={newCount}
            skipCount={skipCount}
            format={parsed.format}
            parserSkipped={parsed.skipped}
          />
        )}

        {step === "result" && result && (
          <ResultStep result={result} />
        )}

        <DialogFooter>
          {step === "input" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button
                disabled={!canPreview}
                onClick={() => setStep("preview")}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                Preview
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("input")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={newCount === 0 || submitting}
                onClick={handleImport}
              >
                {submitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                    Importing…
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 h-4 w-4" />
                    {`Import ${newCount} host(s)`}
                  </>
                )}
              </Button>
            </>
          )}
          {step === "result" && (
            <Button onClick={handleClose}>
              <Check className="mr-2 h-4 w-4" />
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewStep({
  rows,
  errors,
  newCount,
  skipCount,
  format,
  parserSkipped,
}: {
  rows: {
    draft: ProxyHostImportDraft;
    status: "new" | "skip";
    conflictDomain?: string;
  }[];
  errors: ImportResult["errors"];
  newCount: number;
  skipCount: number;
  format: ImportResult["format"];
  parserSkipped: ImportResult["skipped"];
}) {
  return (
    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted">Format: {format === "caddy-json" ? "Caddy JSON" : "Caddyfile"}</Badge>
        <Badge variant="success">{newCount} new</Badge>
        <Badge variant="muted">{skipCount + parserSkipped.length} skip</Badge>
        <Badge variant="destructive">{errors.length} error</Badge>
      </div>

      {rows.length > 0 && (
        <div className="rounded-md border max-h-[40vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="text-left font-medium px-3 py-2">Domains</th>
                <th className="text-left font-medium px-3 py-2">Upstream</th>
                <th className="text-left font-medium px-3 py-2">Features</th>
                <th className="text-left font-medium px-3 py-2 w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">
                    <div className="flex items-center gap-1">
                      <span>{row.draft.domains.join(", ")}</span>
                      {row.draft.warnings && row.draft.warnings.length > 0 && (
                        <span title={row.draft.warnings.join("\n")}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.draft.upstream}</td>
                  <td className="px-3 py-2">
                    <FeatureBadges draft={row.draft} />
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "new" ? (
                      <Badge variant="success">New</Badge>
                    ) : (
                      <Badge
                        variant="muted"
                        title={`Domain already in use: ${row.conflictDomain}`}
                      >
                        Skip — exists
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Parse errors</Label>
          {errors.map((err, idx) => (
            <Alert key={idx} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">
                  {err.locator}: {err.message}
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-destructive/10 p-2 font-mono text-[11px]">
                  {err.raw}
                </pre>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {parserSkipped.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Skipped by parser</Label>
          <ul className="flex flex-col gap-1">
            {parserSkipped.map((s) => (
              <li key={s.draft.domains.join(",")} className="flex items-start gap-2 text-sm">
                <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span>
                  <span className="font-mono">{s.draft.domains.join(", ")}</span>
                  <span className="text-muted-foreground">{` — ${s.reason}`}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FeatureBadges({ draft }: { draft: ProxyHostImportDraft }) {
  const badges: React.ReactNode[] = [];
  if (draft.skipHttpsHostnameValidation) {
    badges.push(
      <Badge key="tls" variant="muted" className="text-[10px]">
        TLS skip
      </Badge>
    );
  }
  if (draft.redirects && draft.redirects.length > 0) {
    badges.push(
      <Badge key="redir" variant="muted" className="text-[10px]">
        {draft.redirects.length} redirect{draft.redirects.length === 1 ? "" : "s"}
      </Badge>
    );
  }
  if (draft.locationRules && draft.locationRules.length > 0) {
    badges.push(
      <Badge key="loc" variant="muted" className="text-[10px]">
        {draft.locationRules.length} location rule{draft.locationRules.length === 1 ? "" : "s"}
      </Badge>
    );
  }
  if (badges.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

function ResultStep({ result }: { result: ImportProxyHostsResult }) {
  return (
    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
      <ResultSection
        label="Created"
        count={result.created.length}
        emptyText="No hosts created."
      >
        <ul className="flex flex-col gap-1">
          {result.created.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 text-sm font-mono"
            >
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              {c.primaryDomain}
            </li>
          ))}
        </ul>
      </ResultSection>

      <ResultSection
        label="Skipped"
        count={result.skipped.length}
        emptyText="Nothing skipped."
      >
        <ul className="flex flex-col gap-1">
          {result.skipped.map((s, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm"
            >
              <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span>
                <span className="font-mono">{s.domains.join(", ")}</span>
                <span className="text-muted-foreground">{` — ${s.reason}`}</span>
              </span>
            </li>
          ))}
        </ul>
      </ResultSection>

      <ResultSection
        label="Parse errors"
        count={result.errors.length}
        emptyText="No parse errors."
      >
        <ul className="flex flex-col gap-1">
          {result.errors.map((err, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm"
            >
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span className="text-muted-foreground">
                {err.locator}: {err.message}
              </span>
            </li>
          ))}
        </ul>
      </ResultSection>
    </div>
  );
}

function ResultSection({
  label,
  count,
  emptyText,
  children,
}: {
  label: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <Badge variant="muted">{count}</Badge>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  );
}
