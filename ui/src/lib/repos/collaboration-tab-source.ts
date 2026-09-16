/**
 * ToDo + Discussions source policy.
 *
 * Forge-backed repos (GitHub/GitLab/Codeberg/Gitea `source`): show the forge
 * copy in-tab, never write back. Nostr-only repos: full create/edit, with a
 * Nostr vs this-browser choice when both copies exist.
 */
import { parseGiteaCompatibleRepo } from "./gitea-forge";

export type CollaborationTabMode = "forge-readonly" | "nostr-local";

export type CollaborationViewPref = "nostr" | "local";

export const COLLAB_VIEW_PREF_PREFIX = "gittr_collab_view__";

function urlLooksLikeForeignForge(raw: string | undefined | null): boolean {
  const url = (raw || "").trim();
  if (!url) return false;
  const lower = url.toLowerCase();
  if (
    lower.includes("github.com") ||
    lower.includes("gitlab.com") ||
    lower.includes("codeberg.org")
  ) {
    return true;
  }
  return !!parseGiteaCompatibleRepo(url);
}

export function collaborationTabMode(opts: {
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  clone?: string[] | null;
}): CollaborationTabMode {
  void opts.clone;
  for (const candidate of [opts.sourceUrl, opts.forkedFrom]) {
    if (urlLooksLikeForeignForge(candidate)) return "forge-readonly";
  }
  return "nostr-local";
}

export function collabViewPrefKey(entity: string, repo: string): string {
  return `${COLLAB_VIEW_PREF_PREFIX}${entity}__${repo}`;
}

export function readCollabViewPref(
  entity: string,
  repo: string
): CollaborationViewPref {
  if (typeof window === "undefined") return "nostr";
  try {
    const raw = localStorage.getItem(collabViewPrefKey(entity, repo));
    return raw === "local" ? "local" : "nostr";
  } catch {
    return "nostr";
  }
}

export function writeCollabViewPref(
  entity: string,
  repo: string,
  pref: CollaborationViewPref
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(collabViewPrefKey(entity, repo), pref);
  } catch {
    /* quota */
  }
}

export function isGithubCollaborationUrl(
  url: string | undefined | null
): boolean {
  return (url || "").toLowerCase().includes("github.com");
}
