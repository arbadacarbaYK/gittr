import { nip19 } from "nostr-tools";

function entityForRepoTag(entity: string): string {
  if (!entity) return "";
  if (entity.startsWith("npub")) return entity;
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity.toLowerCase());
    } catch {
      return entity.toLowerCase();
    }
  }
  return entity;
}

/** All `#repo` tag values that may have been used for this repo (npub vs hex vs URL entity). */
export function discussionRepoTagValues(
  entity: string,
  repo: string,
  ownerPubkey?: string | null
): string[] {
  const values = new Set<string>();
  const addEntity = (ent: string) => {
    const e = (ent || "").trim();
    const r = (repo || "").trim();
    if (e && r) values.add(`${e}/${r}`);
  };
  addEntity(entity);
  addEntity(entityForRepoTag(entity));
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    const hex = entity.toLowerCase();
    addEntity(hex);
    try {
      addEntity(nip19.npubEncode(hex));
    } catch {
      /* ignore */
    }
  }
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        addEntity(decoded.data.toLowerCase());
      }
    } catch {
      /* ignore */
    }
  }
  if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    const hex = ownerPubkey.toLowerCase();
    addEntity(hex);
    try {
      addEntity(nip19.npubEncode(hex));
    } catch {
      /* ignore */
    }
  }
  return [...values];
}

export function discussionAddressTag(
  ownerPubkey: string | undefined | null,
  repo: string
): string | null {
  if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey) || !repo) {
    return null;
  }
  return `30617:${ownerPubkey.toLowerCase()}:${repo}`;
}

export function discussionNostrFilters(
  entity: string,
  repo: string,
  ownerPubkey?: string | null
): Array<{ kinds: number[]; "#repo"?: string[]; "#a"?: string[] }> {
  const repoTags = discussionRepoTagValues(entity, repo, ownerPubkey);
  const filters: Array<{
    kinds: number[];
    "#repo"?: string[];
    "#a"?: string[];
  }> = [];
  if (repoTags.length) {
    filters.push({ kinds: [30023], "#repo": repoTags });
  }
  const aTag = discussionAddressTag(ownerPubkey, repo);
  if (aTag) {
    filters.push({ kinds: [30023], "#a": [aTag] });
  }
  if (!filters.length) {
    filters.push({ kinds: [30023], "#repo": [`${entity}/${repo}`] });
  }
  return filters;
}
