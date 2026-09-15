import {
  dedupeNormalizedCloneUrls,
  gitUrlHostname,
  normalizeCloneUrlKey,
} from "../utils/filter-display-clone-urls";
import { GRASP_DOMAINS_EXCLUDED_FROM_PUSHING } from "../utils/grasp-servers";

import { isForeignForgeUrl } from "./extract-forge-url-from-event-tags";

/** gittr's own git host — never invent it for Git Server when the event omitted it. */
export function isGittrDeploymentCloneHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  return h === "git.gittr.space" || h === "relay.gittr.space";
}

function uniqueHttps(urls: string[]): string[] {
  return dedupeNormalizedCloneUrls(urls.filter((u) => String(u || "").trim()));
}

function isExcludedGraspHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  if (!h) return false;
  return GRASP_DOMAINS_EXCLUDED_FROM_PUSHING.some(
    (d) => h === d || h.endsWith(`.${d}`)
  );
}

/**
 * Union of 30617 `clone[]` tags. Keep older event hosts (so a thinner later
 * note cannot hide git.gittr.space). Drop inferred fetch mirrors that were
 * never on those tags (uid.ovh, ngit-relay.nostrver.se, …).
 */
export function mergeAnnouncementTagClones(
  prevAnnounced: readonly string[] | undefined | null,
  eventTagClones: readonly string[] | undefined | null
): string[] {
  const tags = uniqueHttps(
    (eventTagClones || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  const prev = uniqueHttps(
    (prevAnnounced || []).filter(
      (u) => typeof u === "string" && u.trim().length > 0
    )
  );
  const tagKeys = new Set(tags.map(normalizeCloneUrlKey));
  const tagHosts = new Set(tags.map(gitUrlHostname).filter(Boolean));
  const keptPrev = prev.filter((u) => {
    const h = gitUrlHostname(u);
    if (!isExcludedGraspHost(h)) return true;
    return tagKeys.has(normalizeCloneUrlKey(u)) || tagHosts.has(h);
  });
  return uniqueHttps([...tags, ...keptPrev]);
}

/**
 * Clone URL rows: every `clone[]` URL we already have from the announcement
 * (and persisted / merged copies of that event), plus forge `source`.
 * Do not hide git.gittr.space when it is on those lists. has-files is a badge
 * elsewhere — it must not change which rows appear.
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
  return uniqueHttps([...announced, ...merged, ...forge]);
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
