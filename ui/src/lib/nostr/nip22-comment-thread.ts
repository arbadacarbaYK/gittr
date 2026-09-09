import { resolveEntityToPubkey } from "../utils/entity-resolver";

export type Nip22Comment = {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  parentId?: string;
  nostrEventId: string;
};

type Tagged = {
  id?: string;
  pubkey?: string;
  content?: string;
  created_at?: number;
  tags?: unknown[];
};

function tagRows(event: Tagged): string[][] {
  return Array.isArray(event.tags)
    ? event.tags.filter(
        (t): t is string[] => Array.isArray(t) && typeof t[0] === "string"
      )
    : [];
}

/** True when two identifiers are the same person (hex, npub, or mixed). */
export function pubkeysReferToSamePerson(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ha = resolveEntityToPubkey(a);
  const hb = resolveEntityToPubkey(b);
  return Boolean(ha && hb && ha === hb);
}

export function eventReferencesRoot(
  event: Tagged,
  rootEventId: string
): boolean {
  const root = String(rootEventId || "").toLowerCase();
  if (!root) return false;
  return tagRows(event).some(
    (t) =>
      (t[0] === "E" || t[0] === "e") &&
      typeof t[1] === "string" &&
      t[1].toLowerCase() === root
  );
}

/**
 * Custom `repo` tag is optional. When present, owner may be npub or hex
 * (MCP writes hex; gittr issue UI often writes the URL npub).
 */
export function repoTagMatchesRoute(
  repoTag: string[] | undefined,
  entity: string,
  repo: string
): boolean {
  if (!repoTag || repoTag[0] !== "repo") return true;
  if ((repoTag[2] || "") !== repo) return false;
  const tagged = repoTag[1] || "";
  return pubkeysReferToSamePerson(tagged, entity);
}

export function commentEventBelongsToThread(
  event: Tagged,
  opts: { rootEventId: string; entity: string; repo: string }
): boolean {
  if (!eventReferencesRoot(event, opts.rootEventId)) return false;
  const repoTag = tagRows(event).find((t) => t[0] === "repo");
  return repoTagMatchesRoute(repoTag, opts.entity, opts.repo);
}

export function parseNip22Comment(
  event: Tagged,
  rootEventId: string
): Nip22Comment | null {
  const id = typeof event.id === "string" ? event.id : "";
  const author = typeof event.pubkey === "string" ? event.pubkey : "";
  if (!id || !author) return null;
  const root = String(rootEventId || "").toLowerCase();
  const eTags = tagRows(event).filter((t) => t[0] === "e" && t[1]);
  const parentTag = eTags.find(
    (t) => String(t[1] || "").toLowerCase() !== root
  );
  const replyMarker = tagRows(event).find(
    (t) => (t[0] === "e" || t[0] === "E") && t[3] === "reply" && t[1]
  );
  let parentId: string | undefined;
  if (parentTag?.[1] && parentTag[1].toLowerCase() !== root) {
    parentId = parentTag[1];
  } else if (replyMarker?.[1] && replyMarker[1].toLowerCase() !== root) {
    parentId = replyMarker[1];
  }
  return {
    id,
    author,
    content: typeof event.content === "string" ? event.content : "",
    createdAt: Number(event.created_at || 0) * 1000,
    parentId,
    nostrEventId: id,
  };
}

export function prCommentsStorageKey(
  entity: string,
  repo: string,
  rootId: string
): string {
  return `gittr_pr_comments_${entity}_${repo}_${rootId}`;
}
