"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BasePathProvider } from "@/src/hooks/useBasePath";

export default function Providers({ children, nonce, basePath = "" }: { children: ReactNode; nonce?: string; basePath?: string }) {
  return (
    <BasePathProvider basePath={basePath}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
    </BasePathProvider>
  );
}
