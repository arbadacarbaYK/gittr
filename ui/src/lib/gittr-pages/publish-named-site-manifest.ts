import {
  gittrPagesBlossomOrigin,
  gittrPagesBlossomServerTag,
} from "@/lib/gittr-pages/gittr-pages-blossom-origin";
import {
  isStrictJsonUtf8Document,
  manifestUploadContentType,
  normalizeBlossomUploadBytes,
} from "@/lib/gittr-pages/blossom-upload-mime";
import { KIND_NSITE_NAMED } from "@/lib/nostr/events";
import { publishWithConfirmation } from "@/lib/nostr/publish-with-confirmation";
import {
  loadRepoFiles,
  loadRepoOverrides,
  normalizeFilePath,
  resolveRepoStorageAlias,
} from "@/lib/repos/storage";

import { getEventHash } from "nostr-tools";

/** Must stay ≤ `MAX_BYTES` in `blossom-proxy-upload` (currently 4 MiB per POST body). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** One publish run: sum of all uploaded static bytes (browser + JSON payload budget). */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/**
 * One publish run: how many static paths we attempt. Each file triggers a NIP-07 sign for kind 24242.
 * Large values mean many extension prompts in one session.
 */
const MAX_FILES = 2000;
const KIND_BLOSSOM_SERVER_LIST = 10063;

const SKIP_PATH_PREFIXES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "target/",
  "__tests__/",
  "coverage/",
];

const STATIC_EXT = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".txt",
  ".md",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".map",
  ".xml",
  ".webmanifest",
  ".wasm",
]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export function isGittrPagesManifestPath(path: string): boolean {
  const n = normalizeFilePath(path).toLowerCase();
  if (!n) return false;
  for (const p of SKIP_PATH_PREFIXES) {
    if (n.startsWith(p)) return false;
  }
  const ext = extOf(n);
  if (ext && STATIC_EXT.has(ext)) return true;
  return n === "robots.txt" || n.endsWith("/robots.txt");
}

function toWebAbsolutePath(normalizedPath: string): string {
  const p = normalizeFilePath(normalizedPath);
  return p.startsWith("/") ? p : `/${p}`;
}

function repoFileContentToBytes(
  content: string | undefined,
  isBinary: boolean | undefined
): Uint8Array | null {
  if (content === undefined || content === null) return null;
  if (!isBinary) {
    return new TextEncoder().encode(content);
  }
  try {
    const clean = content.replace(/\s/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const u = new URL(withProto);
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function readLatestBlossomServerListEvent(
  subscribe: PublishNamedSiteManifestOptions["subscribe"],
  relays: string[],
  authorHex: string,
  timeoutMs = 2500
): Promise<{ created_at?: number; tags?: unknown } | null> {
  return new Promise((resolve) => {
    let latest: { created_at?: number; tags?: unknown } | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve(latest);
    };
    const unsub = subscribe(
      [{ kinds: [KIND_BLOSSOM_SERVER_LIST], authors: [authorHex], limit: 20 }],
      relays,
      (event: any) => {
        const ts = Number(event?.created_at ?? 0);
        const currentTs = Number(latest?.created_at ?? 0);
        if (!latest || ts > currentTs) latest = event;
      },
      timeoutMs
    );
    setTimeout(finish, timeoutMs);
  });
}

/** Cap BUD-11 upload token lifetime (batch publishes need headroom for many PUTs). */
const BLOSSOM_BATCH_AUTH_MAX_SEC = 7200;
const BLOSSOM_BATCH_AUTH_BASE_SEC = 600;
const BLOSSOM_BATCH_AUTH_PER_HASH_SEC = 45;

function blossomBatchAuthTtlSeconds(hashCount: number): number {
  const n = Math.max(0, hashCount);
  return Math.min(
    BLOSSOM_BATCH_AUTH_MAX_SEC,
    BLOSSOM_BATCH_AUTH_BASE_SEC + n * BLOSSOM_BATCH_AUTH_PER_HASH_SEC
  );
}

function buildUnsignedBlossomUploadAuth(params: {
  pubkeyHex: string;
  /** One or many blob hashes — one `x` tag each (BUD-11 / hzrd149 blossom-server). */
  sha256Hex: string | string[];
  expiresInSeconds?: number;
}): {
  kind: number;
  created_at: number;
  pubkey: string;
  tags: string[][];
  content: string;
  id: string;
  sig: string;
} {
  const now = Math.floor(Date.now() / 1000);
  const raw = Array.isArray(params.sha256Hex)
    ? params.sha256Hex
    : [params.sha256Hex];
  const uniq = Array.from(
    new Set(raw.map((h) => String(h).toLowerCase()))
  ).sort();
  const tags: string[][] = [
    ["t", "upload"],
    [
      "expiration",
      String(
        now +
          (params.expiresInSeconds ??
            blossomBatchAuthTtlSeconds(uniq.length))
      ),
    ],
    ...uniq.map((h) => ["x", h] as string[]),
  ];
  const srv = gittrPagesBlossomServerTag();
  if (srv) tags.push(srv);
  const n = uniq.length;
  return {
    kind: 24242,
    created_at: now,
    pubkey: params.pubkeyHex.toLowerCase(),
    tags,
    content:
      n <= 1
        ? "gittr Pages: Blossom upload (Blossom)"
        : `gittr Pages: Blossom batch upload (${n} blobs)`,
    id: "",
    sig: "",
  };
}

type MergedManifestFile = {
  path: string;
  content: string;
  isBinary?: boolean;
  /** e.g. raw.githubusercontent.com — used when local `content` is empty */
  remoteUrl?: string;
};

function mergeRepoFilesForManifest(
  entity: string,
  repo: string
): MergedManifestFile[] {
  const files = loadRepoFiles(entity, repo);
  const overrides = loadRepoOverrides(entity, repo);
  const out: MergedManifestFile[] = [];
  for (const f of files) {
    const path = normalizeFilePath(f.path || "");
    if (!path) continue;
    const o =
      overrides[path] ??
      overrides[f.path || ""] ??
      (f as { content?: string }).content ??
      "";
    const content = typeof o === "string" ? o : String(o);
    const url = (f as { url?: string }).url;
    out.push({
      path,
      content,
      isBinary: f.isBinary,
      remoteUrl:
        typeof url === "string" && url.trim().startsWith("http")
          ? url.trim()
          : undefined,
    });
  }
  return out;
}

type GitFileContentJson = {
  content?: string;
  isBinary?: boolean;
};

function bytesFromGitFileContentJson(
  data: GitFileContentJson
): Uint8Array | null {
  if (typeof data.content !== "string" || !data.content.length) return null;
  if (data.isBinary) {
    return repoFileContentToBytes(data.content, true);
  }
  return new TextEncoder().encode(data.content);
}

async function fetchFileFromGitSource(
  path: string,
  gitSourceUrl: string,
  branch: string
): Promise<Uint8Array | null> {
  const qs = new URLSearchParams({
    sourceUrl: gitSourceUrl,
    path: normalizeFilePath(path),
    branch,
  });
  const res = await fetch(`/api/git/file-content?${qs.toString()}`);
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as GitFileContentJson;
    return bytesFromGitFileContentJson(data);
  } catch {
    return null;
  }
}

async function fetchFileFromBridge(
  path: string,
  ownerPubkeyHex: string,
  repo: string,
  branch: string
): Promise<Uint8Array | null> {
  const qs = new URLSearchParams({
    ownerPubkey: ownerPubkeyHex,
    repo,
    path: normalizeFilePath(path),
    branch,
  });
  const res = await fetch(`/api/nostr/repo/file-content?${qs.toString()}`);
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as GitFileContentJson;
    return bytesFromGitFileContentJson(data);
  } catch {
    return null;
  }
}

/** Bridge may index `repo` under the stored slug while the URL uses a pretty variant — try both. */
async function fetchFileFromBridgeWithRepoFallback(
  path: string,
  ownerPubkeyHex: string,
  primaryRepo: string,
  urlRepoSegment: string,
  branch: string
): Promise<Uint8Array | null> {
  const first = await fetchFileFromBridge(
    path,
    ownerPubkeyHex,
    primaryRepo,
    branch
  );
  if (first && first.length > 0) return first;
  if (primaryRepo !== urlRepoSegment) {
    return fetchFileFromBridge(path, ownerPubkeyHex, urlRepoSegment, branch);
  }
  return null;
}

/**
 * Resolve file bytes: localStorage → optional direct HTTPS URL → git source proxy → bridge file API.
 * `skipLocal`: manifest publish can refetch from git/bridge when browser storage has a JSON blob on a `.js` path.
 */
async function resolveManifestFileBytes(
  file: MergedManifestFile,
  ctx: {
    gitSourceUrl?: string;
    defaultBranch: string;
    ownerPubkeyHex: string;
    repo: string;
    /** Route / URL repo segment when it differs from `repo` (storage / bridge primary). */
    urlRepoSegment?: string;
    skipLocal?: boolean;
  }
): Promise<Uint8Array | null> {
  if (!ctx.skipLocal) {
    const local = repoFileContentToBytes(file.content, file.isBinary);
    if (local && local.length > 0) return local;
  }

  if (file.remoteUrl) {
    try {
      const r = await fetch(file.remoteUrl, { credentials: "omit" });
      if (r.ok) {
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length > 0) return buf;
      }
    } catch {
      /* CORS or offline */
    }
  }

  if (ctx.gitSourceUrl && /^https:\/\//i.test(ctx.gitSourceUrl.trim())) {
    const fromGit = await fetchFileFromGitSource(
      file.path,
      ctx.gitSourceUrl.trim(),
      ctx.defaultBranch
    );
    if (fromGit && fromGit.length > 0) return fromGit;
  }

  if (/^[0-9a-f]{64}$/i.test(ctx.ownerPubkeyHex)) {
    const urlSeg = ctx.urlRepoSegment ?? ctx.repo;
    const fromBridge = await fetchFileFromBridgeWithRepoFallback(
      file.path,
      ctx.ownerPubkeyHex.toLowerCase(),
      ctx.repo,
      urlSeg,
      ctx.defaultBranch
    );
    if (fromBridge && fromBridge.length > 0) return fromBridge;
  }

  return null;
}

/**
 * Browser `gittr_files` often wins over git/bridge. If someone pasted JSON (activity feed, API
 * response) into `app-calendar.js`, local storage stays a JSON document while the bridge has
 * real JS — Blossom then returns 400 (MIME vs bytes). When normalized local bytes are strict
 * JSON on a script extension and a remote source exists, load bytes without localStorage.
 */
async function preferRemoteWhenScriptPathLooksLikeJsonDocument(
  file: MergedManifestFile,
  ctx: {
    gitSourceUrl?: string;
    defaultBranch: string;
    ownerPubkeyHex: string;
    repo: string;
    urlRepoSegment?: string;
  },
  normalizedBytes: Uint8Array,
  onProgress?: (message: string) => void
): Promise<Uint8Array> {
  const ext = extOf(file.path).toLowerCase();
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs") return normalizedBytes;
  if (!isStrictJsonUtf8Document(normalizedBytes)) return normalizedBytes;

  const hasRemote =
    (typeof file.remoteUrl === "string" &&
      file.remoteUrl.trim().startsWith("http")) ||
    (ctx.gitSourceUrl && /^https:\/\//i.test(ctx.gitSourceUrl.trim())) ||
    /^[0-9a-f]{64}$/i.test(ctx.ownerPubkeyHex);
  if (!hasRemote) return normalizedBytes;

  const remote = await resolveManifestFileBytes(file, {
    ...ctx,
    skipLocal: true,
  });
  if (!remote || remote.length === 0) return normalizedBytes;

  const normRemote = normalizeBlossomUploadBytes(file.path, remote);
  if (isStrictJsonUtf8Document(normRemote)) return normalizedBytes;

  onProgress?.(
    `${normalizeFilePath(
      file.path
    )}: editor storage looked like JSON on a script path — using git/bridge (or file URL) instead for Blossom.`
  );
  return normRemote;
}

export type PublishNamedSiteManifestOptions = {
  entity: string;
  repo: string;
  ownerPubkeyHex: string;
  dTag: string;
  siteTitle: string;
  siteDescription?: string;
  /** Optional https URL for NIP-5A source tag (e.g. git remote web). */
  sourceUrl?: string;
  /** Repo import URL (GitHub/GitLab) — used to load file bytes when localStorage has metadata only. */
  gitSourceUrl?: string;
  /** Branch for git/bridge file-content APIs (default main). */
  defaultBranch?: string;
  publish: (event: unknown, relays: string[]) => void;
  subscribe: (
    filters: unknown[],
    relays: string[],
    onEvent: (event: unknown, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void;
  defaultRelays: string[];
  onProgress?: (message: string) => void;
};

export type PublishNamedSiteManifestResult =
  | {
      ok: true;
      manifestEventId: string;
      pathCount: number;
      confirmed: boolean;
      serverListEventId?: string;
      serverListConfirmed?: boolean;
    }
  | { ok: false; error: string };

/**
 * Uploads static site files to Blossom (via same-origin proxy + NIP-07 kind 24242),
 * then signs and publishes NIP-5A named-site manifest kind 35128 with NIP-07.
 */
export async function publishNamedSiteManifest(
  opts: PublishNamedSiteManifestOptions
): Promise<PublishNamedSiteManifestResult> {
  const {
    entity,
    repo,
    ownerPubkeyHex,
    dTag,
    siteTitle,
    siteDescription,
    sourceUrl,
    gitSourceUrl,
    defaultBranch: defaultBranchOpt,
    publish,
    subscribe,
    defaultRelays,
    onProgress,
  } = opts;

  const defaultBranch =
    typeof defaultBranchOpt === "string" && defaultBranchOpt.trim()
      ? defaultBranchOpt.trim()
      : "main";

  if (typeof window === "undefined") {
    return { ok: false, error: "Publish manifest runs in the browser only." };
  }
  if (!window.nostr?.signEvent || !window.nostr?.getPublicKey) {
    return { ok: false, error: "NIP-07 signer not available in this browser." };
  }

  const signerPk = (await window.nostr.getPublicKey()).toLowerCase();
  if (signerPk !== ownerPubkeyHex.toLowerCase()) {
    return {
      ok: false,
      error:
        "Signed-in pubkey must match the repository owner to publish this named site manifest.",
    };
  }

  const urlRepoSegment = repo;
  const storageRepo = resolveRepoStorageAlias(entity, urlRepoSegment);
  if (storageRepo !== urlRepoSegment) {
    onProgress?.(
      `Using stored repo key "${storageRepo}" for files/bridge (URL segment "${urlRepoSegment}").`
    );
  }

  const merged = mergeRepoFilesForManifest(entity, storageRepo);
  const resolveCtx = {
    gitSourceUrl: gitSourceUrl?.trim() || undefined,
    defaultBranch,
    ownerPubkeyHex,
    repo: storageRepo,
    urlRepoSegment,
  };

  const manifestPaths = merged.filter((f) => isGittrPagesManifestPath(f.path));

  const uploads: Array<{ webPath: string; sha256: string }> = [];
  let totalBytes = 0;

  const indexPath = manifestPaths.find(
    (c) =>
      toWebAbsolutePath(c.path).toLowerCase() === "/index.html" ||
      normalizeFilePath(c.path).toLowerCase() === "index.html"
  );
  if (!indexPath) {
    return {
      ok: false,
      error:
        "Missing index.html in this repo’s file list. Add a root index.html (or refetch) before publishing the manifest.",
    };
  }
  onProgress?.("Loading index.html (local, GitHub, or bridge)…");
  const indexProbe = await resolveManifestFileBytes(indexPath, resolveCtx);
  if (!indexProbe || indexProbe.length === 0) {
    return {
      ok: false,
      error:
        "index.html has no readable bytes. Gittr only had file metadata (e.g. GitHub RAW link) in this browser. Fix: ensure the repo has a **GitHub/GitLab source URL** stored (imported repo) or open **index.html** once so content loads locally, then retry. This flow also loads bytes via /api/git/file-content when that source URL is set.",
    };
  }

  onProgress?.(
    `Preparing ${
      manifestPaths.length
    } path(s) for Blossom (max ${MAX_FILES}, ${Math.round(
      MAX_TOTAL_BYTES / 1e6
    )} MB total)…`
  );

  type Staged = {
    file: MergedManifestFile;
    bytes: Uint8Array;
    sha256: string;
    webPath: string;
  };
  const staged: Staged[] = [];
  let stagedBytes = 0;

  for (const file of manifestPaths) {
    if (staged.length >= MAX_FILES) {
      return {
        ok: false,
        error: `Too many static files for one publish (>${MAX_FILES}). Exclude heavy trees (e.g. vendor) from the Pages set or split into smaller publishes.`,
      };
    }
    let bytes = await resolveManifestFileBytes(file, resolveCtx);
    if (!bytes || bytes.length === 0) {
      continue;
    }
    bytes = normalizeBlossomUploadBytes(file.path, bytes);
    bytes = await preferRemoteWhenScriptPathLooksLikeJsonDocument(
      file,
      resolveCtx,
      bytes,
      onProgress
    );
    if (bytes.length > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `File too large for Blossom upload: ${file.path} (${bytes.length} bytes). Max per file is ${MAX_FILE_BYTES}.`,
      };
    }
    if (stagedBytes + bytes.length > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: `Total static payload exceeds ${MAX_TOTAL_BYTES} bytes. Trim assets or use fewer files.`,
      };
    }

    const sha256 = await sha256Hex(bytes);
    const webPath = toWebAbsolutePath(file.path);
    staged.push({ file, bytes, sha256, webPath });
    stagedBytes += bytes.length;
  }

  if (staged.length === 0) {
    return {
      ok: false,
      error:
        "No file bytes could be read for upload. Check file contents in storage.",
    };
  }
  if (
    !staged.some(
      (s) => s.webPath.replace(/\/+/g, "/").toLowerCase() === "/index.html"
    )
  ) {
    return {
      ok: false,
      error:
        "index.html was not included in uploadable files (empty or unreadable after processing). Fix the file content and retry.",
    };
  }

  const allHashes = staged.map((s) => s.sha256);
  const distinctHashCount = new Set(allHashes).size;
  onProgress?.(
    `Signing one Blossom upload token (kind 24242) for ${staged.length} file(s)…`
  );
  let auth = buildUnsignedBlossomUploadAuth({
    pubkeyHex: signerPk,
    sha256Hex: allHashes,
    expiresInSeconds: blossomBatchAuthTtlSeconds(distinctHashCount),
  });
  auth.id = getEventHash(auth);
  let signedAuth: typeof auth;
  try {
    signedAuth = (await window.nostr.signEvent(auth)) as typeof auth;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Blossom auth signing cancelled or failed: ${msg}`,
    };
  }

  let uploadOrdinal = 0;
  for (const { file, bytes, sha256, webPath } of staged) {
    let contentType = manifestUploadContentType(file.path, bytes);
    let blossomJsonMimeRetried = false;

    let uploadOk = false;
    let lastUploadErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        onProgress?.(
          `Blossom upload retry ${attempt}/3 for ${webPath} (transient error)…`
        );
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }

      const uploadPayload = JSON.stringify({
        authEvent: signedAuth,
        contentBase64: bytesToBase64(bytes),
        sha256,
        contentType,
      });

      const proxyRes = await fetch("/api/gittr-pages/blossom-proxy-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: uploadPayload,
      });

      const proxyJson = (await proxyRes.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        body?: string;
        hint?: string;
      };

      if (proxyRes.ok) {
        uploads.push({ webPath, sha256 });
        totalBytes += bytes.length;
        uploadOrdinal++;
        onProgress?.(
          `Uploaded ${webPath} (${uploadOrdinal}/${staged.length})`
        );
        uploadOk = true;
        break;
      }

      const detail = proxyJson.body
        ? ` — ${String(proxyJson.body).slice(0, 160)}`
        : "";
      const hintTail = proxyJson.hint
        ? `\n\n${String(proxyJson.hint).slice(0, 520)}`
        : "";
      lastUploadErr = `Blossom upload failed for ${webPath}: ${
        proxyJson.error || proxyRes.status
      }${proxyJson.reason ? ` (${proxyJson.reason})` : ""}${detail}${hintTail}`;

      const blossomWantsJsonMime =
        proxyRes.status === 400 &&
        !blossomJsonMimeRetried &&
        contentType !== "application/json" &&
        (String(proxyJson.reason ?? "").includes("expected application/json") ||
          String(proxyJson.body ?? "").includes("expected application/json"));

      if (blossomWantsJsonMime) {
        blossomJsonMimeRetried = true;
        contentType = "application/json";
        onProgress?.(
          `${webPath}: Blossom MIME check expects application/json — retrying once with that Content-Type…`
        );
        attempt--;
        continue;
      }

      const retryable =
        proxyRes.status === 502 ||
        proxyRes.status === 503 ||
        proxyRes.status === 504 ||
        proxyRes.status === 429;
      if (!retryable) {
        return { ok: false, error: lastUploadErr };
      }
    }

    if (!uploadOk) {
      return { ok: false, error: lastUploadErr };
    }
  }

  if (uploads.length === 0) {
    return {
      ok: false,
      error:
        "No file bytes could be read for upload. Check file contents in storage.",
    };
  }
  if (
    !uploads.some(
      (u) => u.webPath.replace(/\/+/g, "/").toLowerCase() === "/index.html"
    )
  ) {
    return {
      ok: false,
      error:
        "index.html was not uploaded (empty or unreadable after processing). Fix the file content and retry.",
    };
  }

  const serverTagUrl = gittrPagesBlossomOrigin();

  const tags: string[][] = [
    ["d", dTag],
    ...uploads.map((u) => ["path", u.webPath, u.sha256] as string[]),
    ["server", serverTagUrl],
    ["title", siteTitle.slice(0, 200)],
  ];
  if (siteDescription?.trim()) {
    tags.push(["description", siteDescription.trim().slice(0, 500)]);
  }
  if (sourceUrl?.trim() && /^https?:\/\//i.test(sourceUrl.trim())) {
    tags.push(["source", sourceUrl.trim()]);
  }

  let manifest: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    pubkey: string;
    id: string;
    sig: string;
  } = {
    kind: KIND_NSITE_NAMED,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
    pubkey: signerPk,
    id: "",
    sig: "",
  };
  manifest.id = getEventHash(manifest);

  onProgress?.("Signing NIP-5A manifest (kind 35128)…");
  try {
    manifest = (await window.nostr.signEvent(manifest)) as typeof manifest;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Manifest signing cancelled or failed: ${msg}` };
  }

  onProgress?.("Publishing manifest to relays…");
  const pub = await publishWithConfirmation(
    publish as (e: unknown, r: string[]) => void,
    subscribe as any,
    manifest,
    defaultRelays,
    15000
  );

  if (!manifest.id) {
    return { ok: false, error: "Manifest event missing id after signing." };
  }

  const blossomOrigin = normalizeServerUrl(gittrPagesBlossomOrigin());
  let serverListEventId: string | undefined;
  let serverListConfirmed: boolean | undefined;
  if (blossomOrigin) {
    onProgress?.("Updating Blossom server list (kind 10063)…");
    const latestList = await readLatestBlossomServerListEvent(
      subscribe,
      defaultRelays,
      signerPk
    );
    const existingServerTags = Array.isArray(latestList?.tags)
      ? latestList.tags
      : [];
    const mergedServers = [
      blossomOrigin,
      ...existingServerTags
        .filter(
          (t): t is string[] =>
            Array.isArray(t) && t[0] === "server" && typeof t[1] === "string"
        )
        .map((t) => normalizeServerUrl(t[1] ?? ""))
        .filter((v): v is string => Boolean(v)),
    ];
    const dedupedServers = Array.from(new Set(mergedServers)).slice(0, 20);
    const serverListEvent = {
      kind: KIND_BLOSSOM_SERVER_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: dedupedServers.map((url) => ["server", url]),
      content: "",
      pubkey: signerPk,
      id: "",
      sig: "",
    };
    serverListEvent.id = getEventHash(serverListEvent);
    try {
      const signedServerList = (await window.nostr.signEvent(
        serverListEvent
      )) as typeof serverListEvent;
      const serverListPub = await publishWithConfirmation(
        publish as (e: unknown, r: string[]) => void,
        subscribe as any,
        signedServerList,
        defaultRelays,
        12000
      );
      serverListEventId = signedServerList.id;
      serverListConfirmed = serverListPub.confirmed;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      onProgress?.(`Skipped Blossom server-list update: ${msg}`);
    }
  }

  return {
    ok: true,
    manifestEventId: manifest.id,
    pathCount: uploads.length,
    confirmed: pub.confirmed,
    serverListEventId,
    serverListConfirmed,
  };
}
