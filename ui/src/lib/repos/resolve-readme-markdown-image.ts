/**
 * Resolve README / markdown image src for forge + Nostr-native (GRASP) repos.
 * Relative paths like `docs/assets/foo.png` must show on gittr without Blossom.
 */
export type ReadmeImageResolveInput = {
  src: string;
  branch: string;
  /** Upstream forge URL when known (GitHub / GitLab / Codeberg). */
  forgeSourceUrl?: string | null;
  /** clone: tags — may include https://git.gittr.space/npub…/repo.git */
  cloneUrls?: string[] | null;
  ownerPubkey?: string | null;
  repoName?: string | null;
};

export type ReadmeImageResolveResult = {
  /** Hotlink when forge raw works; empty when we must fetch via same-origin API. */
  primarySrc: string;
  repoPath?: string;
  sourceUrl?: string;
  ownerPubkey?: string;
  repoName?: string;
  /** Load via /api immediately (Nostr / GRASP — no real /raw/ URL). */
  preferApi: boolean;
};

const FORGE_RAW: Array<{
  re: RegExp;
  raw: (owner: string, repo: string, branch: string, path: string) => string;
}> = [
  {
    re: /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
    raw: (o, r, b, p) =>
      `https://raw.githubusercontent.com/${o}/${r}/${encodeURIComponent(b)}/${p}`,
  },
  {
    re: /gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
    raw: (o, r, b, p) =>
      `https://gitlab.com/${o}/${r}/-/raw/${encodeURIComponent(b)}/${p}`,
  },
  {
    re: /codeberg\.org\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
    raw: (o, r, b, p) =>
      `https://codeberg.org/${o}/${r}/raw/branch/${encodeURIComponent(b)}/${p}`,
  },
];

export function normalizeRepoRelPath(src: string): string {
  let p = (src || "").trim();
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);
  // Block path escape theater
  if (p.includes("..") || p.startsWith("~")) return "";
  return p;
}

function pickCloneUrl(clones: string[] | null | undefined): string {
  if (!Array.isArray(clones)) return "";
  for (const raw of clones) {
    if (typeof raw !== "string") continue;
    const u = raw.trim().replace(/\.git$/, "");
    if (/^https?:\/\//i.test(u)) return u;
  }
  return "";
}

/**
 * Build display props for README images. Never invent GRASP `/raw/…` URLs —
 * those 404; use same-origin file-content (preferApi) instead.
 */
export function resolveReadmeMarkdownImage(
  input: ReadmeImageResolveInput
): ReadmeImageResolveResult | null {
  const src = (input.src || "").trim();
  if (!src) return null;

  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:")
  ) {
    return { primarySrc: src, preferApi: false };
  }

  const repoPath = normalizeRepoRelPath(src);
  if (!repoPath) return null;

  const branch = input.branch || "main";
  const forge = (input.forgeSourceUrl || "").replace(/\.git$/, "").trim();
  const clone = pickCloneUrl(input.cloneUrls);
  const ownerPubkey = (input.ownerPubkey || "").trim() || undefined;
  const repoName =
    (input.repoName || "").trim().replace(/\.git$/, "") || undefined;

  for (const f of FORGE_RAW) {
    const m = forge.match(f.re);
    if (m) {
      const owner = m[1] || "";
      const repo = (m[2] || "").replace(/\.git$/, "");
      if (!owner || !repo) continue;
      return {
        primarySrc: f.raw(owner, repo, branch, repoPath),
        repoPath,
        sourceUrl: forge,
        preferApi: false,
      };
    }
  }

  // Nostr / GRASP / self-hosted: load via API (clone URL or ownerPubkey+repo)
  const sourceUrl = clone || forge || undefined;
  if (sourceUrl || (ownerPubkey && repoName)) {
    return {
      primarySrc: "",
      repoPath,
      sourceUrl,
      ownerPubkey,
      repoName,
      preferApi: true,
    };
  }

  return null;
}

export function mimeForRepoImagePath(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "ico") return "image/x-icon";
  return "application/octet-stream";
}
