"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { RepoUiMode } from "@/lib/ui/repo-ui-mode";

/** Default next so all repo Code pages get the new sidebar layout. */
const RepoUiModeContext = createContext<RepoUiMode>("next");

export function RepoUiModeProvider({
  mode,
  children,
}: {
  mode: RepoUiMode;
  children: ReactNode;
}) {
  return (
    <RepoUiModeContext.Provider value={mode}>
      {children}
    </RepoUiModeContext.Provider>
  );
}

export function useRepoUiMode(): RepoUiMode {
  return useContext(RepoUiModeContext);
}
