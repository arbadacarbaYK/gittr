"use client";

import { RepoCodePage } from "@/components/repo/RepoCodePage";
import { getRepoUiMode } from "@/lib/ui/repo-ui-mode";
import { RepoUiModeProvider } from "@/lib/ui/repo-ui-variant-context";

/**
 * Code route — same RepoCodePage + APIs for every entity.
 * UI mode defaults to next (rollback: NEXT_PUBLIC_REPO_UI=classic).
 */
export default function RepoCodePageRoute() {
  const mode = getRepoUiMode();
  return (
    <RepoUiModeProvider mode={mode}>
      <RepoCodePage />
    </RepoUiModeProvider>
  );
}
