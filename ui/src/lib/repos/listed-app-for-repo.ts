/**
 * Match a NIP-82 catalog app to a gittr Code-tab repo so visitors get the
 * same Links → App (id) row owners already get after announce / Push.
 */
import {
  nip34AddressForRepo,
  normalizeRepoAppToken,
} from "../nostr/nip82-repo-releases";
import {
  type NostrEventLike,
  gittrRepoPathFromNip34A,
  readTagAll,
} from "../nostr/nip82-software";

import { isStraySoftwareAppId } from "./enrich-repo-links";

export type ListedAppMatchOpts = {
  ownerPubkeyHex: string;
  repoName: string;
  /** URL entity (`npub1…` or hex) — used with gittrRepoPath. */
  entity?: string | null;
};

export type ListedAppLike = {
  pubkey: string;
  appId: string;
  name: string;
  createdAt: number;
  gittrRepoPath?: string;
  raw?: Pick<NostrEventLike, "tags">;
};

function normalizeGittrPath(path: string): string {
  return path.trim().replace(/\/+$/, "").toLowerCase();
}

/** True when this kind 32267 belongs to this owner + repo. */
export function softwareAppMatchesGittrRepo(
  app: ListedAppLike,
  opts: ListedAppMatchOpts
): boolean {
  const owner = (opts.ownerPubkeyHex || "").trim().toLowerCase();
  const repo = (opts.repoName || "").trim();
  if (!owner || !repo) return false;
  if (app.pubkey.toLowerCase() !== owner) return false;

  const expectedA = nip34AddressForRepo(owner, repo);
  const aTags = app.raw
    ? readTagAll(app.raw as NostrEventLike, "a").map((x) => x.trim())
    : [];
  if (
    expectedA &&
    aTags.some((a) => a.toLowerCase() === expectedA.toLowerCase())
  ) {
    return true;
  }
  for (const a of aTags) {
    const path = gittrRepoPathFromNip34A(a);
    if (path && path.toLowerCase().endsWith(`/${repo.toLowerCase()}`)) {
      return true;
    }
  }

  if (app.gittrRepoPath) {
    const got = normalizeGittrPath(app.gittrRepoPath);
    const entity = (opts.entity || "").trim();
    if (entity) {
      const want = normalizeGittrPath(`/${entity}/${repo}`);
      if (got === want) return true;
    }
    if (got.endsWith(`/${repo.toLowerCase()}`)) return true;
  }

  const repoTok = normalizeRepoAppToken(repo);
  if (!repoTok) return false;
  const nameTok = normalizeRepoAppToken(app.name || "");
  const idTok = normalizeRepoAppToken(app.appId || "");
  return nameTok === repoTok || idTok === repoTok;
}

/** Newest matching catalog app, if any. */
export function pickListedAppForRepo(
  apps: ListedAppLike[] | undefined | null,
  opts: ListedAppMatchOpts
): ListedAppLike | null {
  const matches = (apps || []).filter((app) =>
    softwareAppMatchesGittrRepo(app, opts)
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, cur) =>
    cur.createdAt > best.createdAt ? cur : best
  );
}

/**
 * Local announce wins (next Push). Catalog fills in for visitors who never
 * announced in this browser. Stray `GITTR` is ignored.
 */
export function resolveRepoAppId(
  localAnnouncedAppId?: string | null,
  catalogAppId?: string | null
): string | null {
  for (const raw of [localAnnouncedAppId, catalogAppId]) {
    const id = (raw || "").trim();
    if (id && !isStraySoftwareAppId(id)) return id;
  }
  return null;
}

/** Catalog display name when it is the same package id we are showing. */
export function resolveRepoAppName(
  appId?: string | null,
  catalog?: { appId: string; name: string } | null
): string | null {
  const id = (appId || "").trim();
  const catalogId = (catalog?.appId || "").trim();
  const name = (catalog?.name || "").trim();
  if (!id || !catalogId || !name) return null;
  if (id.toLowerCase() !== catalogId.toLowerCase()) return null;
  return name;
}
