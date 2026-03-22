"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState, useTransition } from "react";
import {
  createCaCertificateAction,
  generateCaCertificateAction,
  updateCaCertificateAction,
} from "../ca-actions";
import type { CaCertificateView } from "../page";

type Props = {
  open: boolean;
  cert: CaCertificateView | null;
  onClose: () => void;
};

export function CaCertDrawer({ open, cert, onClose }: Props) {
  const isEdit = cert !== null;
  const [tab, setTab] = useState<"generate" | "import">("generate");
  const [isPending, startTransition] = useTransition();
  const generateRef = useRef<HTMLFormElement>(null);
  const importRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLFormElement>(null);

  function handleClose() {
    setTab("generate");
    onClose();
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(generateRef.current!);
    startTransition(async () => {
      await generateCaCertificateAction(formData);
      handleClose();
    });
  }

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(importRef.current!);
    startTransition(async () => {
      await createCaCertificateAction(formData);
      handleClose();
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData(editRef.current!);
    startTransition(async () => {
      await updateCaCertificateAction(cert!.id, formData);
      handleClose();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] flex flex-col gap-6 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit CA Certificate" : "Add CA Certificate"}</SheetTitle>
        </SheetHeader>

        {isEdit ? (
          /* Edit form */
          <form
            ref={editRef}
            onSubmit={handleEdit}
            className="flex flex-col gap-4 flex-1"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                name="name"
                required
                defaultValue={cert.name}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-cert-pem">Certificate PEM</Label>
              <Textarea
                id="edit-cert-pem"
                name="certificate_pem"
                required
                defaultValue={cert.certificate_pem}
                rows={8}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">PEM-encoded X.509 CA certificate</p>
            </div>
            <div className="flex gap-2 justify-end mt-auto pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          /* Add: Generate / Import tabs */
          <Tabs value={tab} onValueChange={(v) => setTab(v as "generate" | "import")} className="flex flex-col gap-4 flex-1">
            <TabsList className="w-full">
              <TabsTrigger value="generate" className="flex-1">Generate</TabsTrigger>
              <TabsTrigger value="import" className="flex-1">Import PEM</TabsTrigger>
            </TabsList>

            <TabsContent value="generate">
              <form
                ref={generateRef}
                onSubmit={handleGenerate}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gen-name">Name</Label>
                  <Input
                    id="gen-name"
                    name="name"
                    required
                    autoFocus
                    placeholder="My Client CA"
                  />
                  <p className="text-xs text-muted-foreground">Display name in this UI</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gen-cn">Common Name (CN)</Label>
                  <Input
                    id="gen-cn"
                    name="common_name"
                    placeholder="My Client CA"
                  />
                  <p className="text-xs text-muted-foreground">CN field in the certificate. Defaults to the name above if left blank.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gen-validity">Validity</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="gen-validity"
                      name="validity_days"
                      type="number"
                      defaultValue={3650}
                      min={1}
                      max={3650}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-auto pt-2">
                  <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Generating..." : "Generate CA Certificate"}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="import">
              <form
                ref={importRef}
                onSubmit={handleImport}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="imp-name">Name</Label>
                  <Input
                    id="imp-name"
                    name="name"
                    required
                    autoFocus
                    placeholder="My Client CA"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="imp-cert-pem">Certificate PEM</Label>
                  <Textarea
                    id="imp-cert-pem"
                    name="certificate_pem"
                    required
                    rows={8}
                    placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">PEM-encoded X.509 CA certificate (no private key needed)</p>
                </div>
                <div className="flex gap-2 justify-end mt-auto pt-2">
                  <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Adding..." : "Add CA Certificate"}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
