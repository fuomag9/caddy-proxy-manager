"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { MtlsConfig } from "@/lib/models/proxy-hosts";

type Props = {
  value?: MtlsConfig | null;
  caCertificates: CaCertificate[];
};

export function MtlsFields({ value, caCertificates }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [selectedIds, setSelectedIds] = useState<number[]>(value?.ca_certificate_ids ?? []);

  function toggleId(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-4">
      <input type="hidden" name="mtls_present" value="1" />
      <input type="hidden" name="mtls_enabled" value={enabled ? "true" : "false"} />
      {enabled && selectedIds.map(id => (
        <input key={id} type="hidden" name="mtls_ca_cert_id" value={String(id)} />
      ))}

      {/* Header */}
      <div className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-row items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
            <LockKeyhole className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug">Mutual TLS (mTLS)</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Require clients to present a certificate signed by a trusted CA
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          className="shrink-0"
        />
      </div>

      <div className={cn(
        "overflow-hidden transition-all duration-200",
        enabled ? "max-h-[1000px] opacity-100 mt-4" : "max-h-0 opacity-0 pointer-events-none"
      )}>
        <Alert className="mb-4">
          <AlertDescription>
            mTLS requires TLS to be configured on this host (certificate must be set).
          </AlertDescription>
        </Alert>

        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
          Trusted Client CA Certificates
        </span>

        {caCertificates.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">
            No CA certificates configured. Add them on the Certificates page.
          </p>
        ) : (
          <div className="flex flex-col mt-1">
            {caCertificates.map(ca => (
              <div key={ca.id} className="flex items-center gap-2 py-1">
                <Checkbox
                  id={`ca-cert-${ca.id}`}
                  checked={selectedIds.includes(ca.id)}
                  onCheckedChange={() => toggleId(ca.id)}
                />
                <label htmlFor={`ca-cert-${ca.id}`} className="text-sm cursor-pointer">
                  {ca.name}
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
