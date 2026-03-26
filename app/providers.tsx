"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <TooltipProvider>
        {children}
      </TooltipProvider>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  );
}
