/**
 * Repo Code UI mode.
 *
 * Default is "next" (banner identity chrome + next sidebar layout).
 * Emergency rollback: NEXT_PUBLIC_REPO_UI=classic
 *
 * Legacy preview route /{entity}/{repo}/next redirects to the Code URL.
 */

export type RepoUiMode = "classic" | "next";

/** @deprecated Preview flag — next UI is default; kept for old env files. */
export function isRepoUiNextEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REPO_UI_NEXT !== "0";
}

export function getRepoUiMode(): RepoUiMode {
  const raw = (process.env.NEXT_PUBLIC_REPO_UI || "next").toLowerCase();
  return raw === "classic" ? "classic" : "next";
}

/** Legacy preview path …/next (redirect target detection). */
export function isRepoUiNextPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed.endsWith("/next");
}
