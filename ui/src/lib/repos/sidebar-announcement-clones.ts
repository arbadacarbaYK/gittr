import {
  dedupeNormalizedCloneUrls,
  gitUrlHostname,
} from "../utils/filter-display-clone-urls";

import { isForeignForgeUrl } from "./extract-forge-url-from-event-tags";

/** gittr's own git host — never treat as "the announcement" unless the event listed it. */
export function isGittrDeploymentCloneHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  return h === "git.gittr.space" || h === "relay.gittr.space";
}

function uniqueHttps(urls: string[]): string[] {
  return dedupeNormalizedCloneUrls(urls.filter((u) => String(u || "").trim()));
}

/**
 * Clone URLs to show as "from the announcement".
 * Prefer the live 30617 `clone` tags. Do not mix in successful fetch hosts
 * or inferred git.gittr.space mirrors — those made ngit repos look like gittr.
 */
export function sidebarClonesFromAnnouncement(opts: {
  announcementClones?: string[] | null;
  mergedClones?: string[] | null;
  forgeSourceUrl?: string | null;
}): string[] {
  const announced = uniqueHttps(
    (opts.announcementClones || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  const merged = uniqueHttps(
    (opts.mergedClones || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  const forge =
    opts.forgeSourceUrl && isForeignForgeUrl(opts.forgeSourceUrl)
      ? [opts.forgeSourceUrl]
      : [];
  if (announced.length > 0) {
    // Event clones plus leftover mirrors/forge from local merge. Do not keep an
    // inferred git.gittr.space unless the event actually listed it.
    const announcedHosts = new Set(
      announced.map((u) => gitUrlHostname(u)).filter(Boolean)
    );
    const extraMerged = merged.filter((u) => {
      const h = gitUrlHostname(u);
      if (isGittrDeploymentCloneHost(h) && !announcedHosts.has(h)) {
        return false;
      }
      return true;
    });
    return uniqueHttps([...announced, ...extraMerged, ...forge]);
  }
  return uniqueHttps([
    ...merged.filter((u) => !isGittrDeploymentCloneHost(gitUrlHostname(u))),
    ...forge,
  ]);
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
