"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye, EyeOff, FileUp } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { createCertificateAction, updateCertificateAction } from "../actions";
import type { ImportedCertView } from "../page";

type Props = {
  open: boolean;
  cert: ImportedCertView | null;
  onClose: () => void;
};

export function ImportCertDrawer({ open, cert, onClose }: Props) {
  const isEdit = cert !== null;
  const [isPending, startTransition] = useTransition();
  const [showKey, setShowKey] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const certFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setCertPem("");
    setKeyPem("");
    setShowKey(false);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    startTransition(async () => {
      if (isEdit) {
        await updateCertificateAction(cert.id, formData);
      } else {
        await createCertificateAction(formData);
      }
      handleClose();
    });
  }

  function readFile(file: File, setter: (v: string) => void) {
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target?.result as string);
    reader.readAsText(file);
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] flex flex-col gap-6 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Certificate" : "Import Certificate"}</SheetTitle>
        </SheetHeader>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 flex-1"
        >
          <input type="hidden" name="type" value="imported" />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ic-name">Name</Label>
            <Input
              id="ic-name"
              name="name"
              defaultValue={isEdit ? cert.name : ""}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Descriptive name to identify this certificate</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ic-domains">Domains (one per line)</Label>
            <Textarea
              id="ic-domains"
              name="domain_names"
              defaultValue={isEdit ? cert.domains.join("\n") : ""}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Domains covered by this certificate</p>
          </div>

          {/* Certificate PEM */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ic-cert-pem">Certificate PEM</Label>
              <Textarea
                id="ic-cert-pem"
                name="certificate_pem"
                placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                rows={6}
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">Full chain recommended (cert + intermediates)</p>
            </div>
            <input
              type="file"
              ref={certFileRef}
              accept=".pem,.crt,.cer,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file, setCertPem);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => certFileRef.current?.click()}
            >
              <FileUp className="h-4 w-4 mr-2" />
              Load from file
            </Button>
          </div>

          {/* Private Key PEM */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ic-key-pem">Private Key PEM</Label>
              <div className="relative">
                {showKey ? (
                  <Textarea
                    id="ic-key-pem"
                    name="private_key_pem"
                    placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                    rows={6}
                    value={keyPem}
                    onChange={(e) => setKeyPem(e.target.value)}
                    className="font-mono text-xs"
                  />
                ) : (
                  <Input
                    id="ic-key-pem"
                    name="private_key_pem"
                    type="password"
                    placeholder="••••••••••••••••"
                    value={keyPem}
                    onChange={(e) => setKeyPem(e.target.value)}
                    className="font-mono text-xs pr-10"
                  />
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 h-7 w-7"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "Hide private key" : "Show private key"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{showKey ? "Hide" : "Show"}</TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">Keep this secure! Never share your private key</p>
            </div>
            <input
              type="file"
              ref={keyFileRef}
              accept=".pem,.key,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file, setKeyPem);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => keyFileRef.current?.click()}
            >
              <FileUp className="h-4 w-4 mr-2" />
              Load from file
            </Button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end mt-auto pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save Changes" : "Import Certificate"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
