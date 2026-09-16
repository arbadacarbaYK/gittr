/**
 * After Your Apps "Remove listing", clear announcedAppId so the next Push
 * does not re-announce. Keep the App (id) Links row (except stray GITTR).
 */
import { stripAppListingFromRepoFields } from "./enrich-repo-links";
import { loadStoredRepos, saveStoredRepos } from "./storage";

export function stripAppListingFromStoredRepos(appId: string): boolean {
  if (typeof window === "undefined") return false;
  const drop = appId.trim();
  if (!drop) return false;
  const repos = loadStoredRepos();
  let changed = false;
  const next = repos.map((repo) => {
    const out = stripAppListingFromRepoFields(repo, drop);
    if (!out.changed) return repo;
    changed = true;
    const { changed: _c, ...fields } = out;
    return { ...repo, ...fields };
  });
  if (!changed) return false;
  saveStoredRepos(next);
  window.dispatchEvent(new Event("gittr:repos-updated"));
  return true;
}
