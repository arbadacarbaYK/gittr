const PREFIX = "gittr_pages_site_slug_v1:";

function storageKey(entity: string, repo: string): string {
  return `${PREFIX}${entity}:${repo}`;
}

/** Browser-only backup so a Code-page hydrate cannot silently drop the Pages name. */
export function loadPagesSiteSlugBackup(
  entity: string,
  repo: string
): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(entity, repo));
    const trimmed = (raw || "").trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export function savePagesSiteSlugBackup(
  entity: string,
  repo: string,
  slug: string | undefined
): void {
  if (typeof window === "undefined") return;
  const key = storageKey(entity, repo);
  try {
    const trimmed = (slug || "").trim();
    if (!trimmed) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, trimmed);
  } catch {
    /* quota / private mode */
  }
}

const AUTO_PREFIX = "gittr_pages_auto_readme_v1:";

export function loadPagesAutoReadme(entity: string, repo: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(`${AUTO_PREFIX}${entity}:${repo}`) === "1"
    );
  } catch {
    return false;
  }
}

export function savePagesAutoReadme(
  entity: string,
  repo: string,
  enabled: boolean
): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${AUTO_PREFIX}${entity}:${repo}`;
    if (enabled) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
