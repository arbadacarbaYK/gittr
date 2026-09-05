/**
 * BUD-01 / BUD-11 Blossom upload auth (kind 24242).
 * Not NIP-98: tags are t=upload, x=<sha256>, expiration, optional server=.
 */

export const BLOSSOM_UPLOAD_AUTH_KIND = 24242;

export type UnsignedBlossomUploadAuth = {
  kind: number;
  created_at: number;
  pubkey: string;
  tags: string[][];
  content: string;
};

export function unsignedNgitBlossomUploadAuth(params: {
  pubkeyHex: string;
  sha256Hex: string[];
  /** Hostnames only (e.g. blossom.primal.net), not origins. */
  serverHostnames: string[];
  expiresInSeconds?: number;
}): UnsignedBlossomUploadAuth {
  const now = Math.floor(Date.now() / 1000);
  const pubkey = params.pubkeyHex.trim().toLowerCase();
  const uniq = Array.from(
    new Set(params.sha256Hex.map((h) => String(h).toLowerCase()))
  ).filter((h) => /^[0-9a-f]{64}$/.test(h));
  uniq.sort();
  const hosts = Array.from(
    new Set(
      params.serverHostnames.map((h) => h.trim().toLowerCase()).filter(Boolean)
    )
  );
  const tags: string[][] = [
    ["t", "upload"],
    ["expiration", String(now + (params.expiresInSeconds ?? 15 * 60))],
    ...uniq.map((h) => ["x", h] as string[]),
    ...hosts.map((h) => ["server", h] as string[]),
  ];
  return {
    kind: BLOSSOM_UPLOAD_AUTH_KIND,
    created_at: now,
    pubkey,
    tags,
    content:
      uniq.length <= 1
        ? "gittr: pin forge release to Blossom"
        : `gittr: pin ${uniq.length} forge release files to Blossom`,
  };
}

export type BlossomAuthInspect =
  | { ok: true; pubkey: string; sha256s: string[] }
  | { ok: false; error: string };

function tagValues(tags: unknown, name: string): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === name && typeof t[1] === "string") {
      out.push(t[1]);
    }
  }
  return out;
}

/** Structural checks (signature verified separately). */
export function inspectBlossomUploadAuth(
  event: unknown,
  expectedSha256: string
): BlossomAuthInspect {
  if (!event || typeof event !== "object") {
    return { ok: false, error: "authEvent required" };
  }
  const ev = event as {
    kind?: unknown;
    pubkey?: unknown;
    tags?: unknown;
  };
  if (ev.kind !== BLOSSOM_UPLOAD_AUTH_KIND) {
    return { ok: false, error: "authEvent.kind must be 24242" };
  }
  const pubkey = String(ev.pubkey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return { ok: false, error: "authEvent.pubkey must be 64 hex chars" };
  }
  const tTags = tagValues(ev.tags, "t").map((v) => v.toLowerCase());
  if (!tTags.includes("upload")) {
    return { ok: false, error: "authEvent must include t=upload" };
  }
  const xs = tagValues(ev.tags, "x").map((v) => v.toLowerCase());
  const want = expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want) || !xs.includes(want)) {
    return { ok: false, error: "authEvent must include x tag matching sha256" };
  }
  const expRaw = tagValues(ev.tags, "expiration")[0];
  if (!expRaw) {
    return { ok: false, error: "authEvent missing expiration tag" };
  }
  const expTs = parseInt(expRaw, 10);
  if (!Number.isFinite(expTs) || expTs <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "authEvent expired or invalid expiration" };
  }
  return { ok: true, pubkey, sha256s: xs };
}
