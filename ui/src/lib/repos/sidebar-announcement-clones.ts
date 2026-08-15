import { gitUrlHostname } from "../utils/filter-display-clone-urls";

/** gittr's own git host — never treat as "the announcement" unless the event listed it. */
export function isGittrDeploymentCloneHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  return h === "git.gittr.space" || h === "relay.gittr.space";
}

function uniqueHttps(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const u = String(raw || "").trim();
    if (!u) continue;
    const key = u
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/**
 * Clone URLs to show as "from the announcement".
 * Prefer the live 30617 `clone` tags. Do not mix in successful fetch hosts
 * or inferred git.gittr.space mirrors — those made ngit repos look like gittr.
 */
export function sidebarClonesFromAnnouncement(opts: {
  announcementClones?: string[] | null;
  mergedClones?: string[] | null;
}): string[] {
  const announced = uniqueHttps(
    (opts.announcementClones || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  if (announced.length > 0) return announced;
  const merged = uniqueHttps(
    (opts.mergedClones || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  return merged.filter((u) => !isGittrDeploymentCloneHost(gitUrlHostname(u)));
}

export function pickGitServerFromAnnouncementClones(
  clones: string[],
  opts?: { hasExternalForgeSource?: boolean }
): { href: string; label: string; kind: "clone" } | null {
  const https = clones.filter((u) => /^https?:\/\//i.test(u));
  if (https.length === 0) return null;
  // Nostr-only announces often list gittr + ngit. Prefer git.gittr.space when
  // it is actually on the event (gittr Push). Never invent it. Never apply this
  // bump when the repo has a GitHub/GitLab/Codeberg/Gitea `source`.
  const gittr = https.find((u) => {
    const h = gitUrlHostname(u);
    return h === "git.gittr.space";
  });
  const first = https[0];
  if (!first) return null;
  const pick = !opts?.hasExternalForgeSource && gittr ? gittr : first;
  const href = pick.replace(/\.git$/i, "");
  return {
    href,
    label: href.replace(/^https?:\/\//i, ""),
    kind: "clone",
  };
}
