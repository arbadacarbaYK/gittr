/** Shared 30617 identity helpers (no @/ imports — safe for vitest). */

export function isHexEventId(id: string | undefined | null): id is string {
  return typeof id === "string" && /^[0-9a-f]{64}$/i.test(id);
}

export function repoAnnouncementDTagCandidates(
  repositoryName: string,
  repo?: {
    repositoryName?: string;
    repo?: string;
    slug?: string;
    name?: string;
  } | null
): string[] {
  const out = new Set<string>();
  const add = (v?: string) => {
    const t = (v || "").trim();
    if (t) out.add(t);
  };
  add(repositoryName);
  add(repo?.repositoryName);
  add(repo?.repo);
  add(repo?.slug);
  add(repo?.name);
  return [...out];
}

export function announcementEventMatchesRepo(
  event: { tags: string[][] },
  author: string,
  dCandidates: string[]
): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1]?.trim();
  if (d && dCandidates.some((c) => c.toLowerCase() === d.toLowerCase())) {
    return true;
  }
  const want = new Set(
    dCandidates.map((name) => `30617:${author}:${name}`.toLowerCase())
  );
  for (const t of event.tags) {
    if (t[0] === "a" && typeof t[1] === "string") {
      if (want.has(t[1].toLowerCase())) return true;
    }
  }
  return false;
}
