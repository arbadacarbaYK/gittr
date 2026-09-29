/**
 * Profile → repo is a full page load, which drops the in-memory card.
 * The card already has clone URLs. Stash them so the Code tab can list
 * files without waiting for another relay scan.
 */

const STORAGE_KEY = "gittr:profile-open-v1";
const MAX_AGE_MS = 2 * 60 * 1000;

export type ProfileOpenHandoff = {
  entity: string;
  repo: string;
  ownerPubkey?: string;
  clone: string[];
  sourceUrl?: string;
  at: number;
};

function cleanCloneList(clone: unknown): string[] {
  if (!Array.isArray(clone)) return [];
  return clone
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((u) => u.trim());
}

export function stashProfileOpenHandoff(
  input: Omit<ProfileOpenHandoff, "at">
): void {
  if (typeof window === "undefined") return;
  const entity = String(input.entity || "").trim();
  const repo = String(input.repo || "")
    .trim()
    .replace(/\.git$/i, "");
  if (!entity || !repo) return;
  const payload: ProfileOpenHandoff = {
    entity,
    repo,
    ownerPubkey:
      typeof input.ownerPubkey === "string" && input.ownerPubkey.trim()
        ? input.ownerPubkey.trim()
        : undefined,
    clone: cleanCloneList(input.clone),
    sourceUrl:
      typeof input.sourceUrl === "string" && input.sourceUrl.trim()
        ? input.sourceUrl.trim()
        : undefined,
    at: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function readProfileOpenHandoff(
  entity: string,
  repo: string
): ProfileOpenHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileOpenHandoff;
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - (Number(parsed.at) || 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const wantRepo = String(repo || "")
      .trim()
      .replace(/\.git$/i, "")
      .toLowerCase();
    const gotRepo = String(parsed.repo || "")
      .replace(/\.git$/i, "")
      .toLowerCase();
    const wantEntity = String(entity || "")
      .trim()
      .toLowerCase();
    const gotEntity = String(parsed.entity || "")
      .trim()
      .toLowerCase();
    if (
      !wantEntity ||
      !wantRepo ||
      gotEntity !== wantEntity ||
      gotRepo !== wantRepo
    ) {
      return null;
    }
    return {
      ...parsed,
      clone: cleanCloneList(parsed.clone),
    };
  } catch {
    return null;
  }
}
