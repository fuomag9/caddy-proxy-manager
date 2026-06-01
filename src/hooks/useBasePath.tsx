"use client";

import { createContext, useContext, type ReactNode } from "react";

const BasePathContext = createContext<string>("");

export function BasePathProvider({ basePath, children }: { basePath: string; children: ReactNode }) {
  return <BasePathContext.Provider value={basePath}>{children}</BasePathContext.Provider>;
}

export function useBasePath(): string {
  return useContext(BasePathContext);
}
