import { KIND_NSITE_NAMED } from "@/lib/nostr/events";
import { publishWithConfirmation } from "@/lib/nostr/publish-with-confirmation";
import {
  loadRepoFiles,
  loadRepoOverrides,
  normalizeFilePath,
} from "@/lib/repos/storage";

import { getEventHash } from "nostr-tools";

const MAX_FILE_BYTES = 3_500_000;
const MAX_TOTAL_BYTES = 12_000_000;
const MAX_FILES = 120;

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

/**
 * Content-Type for the upstream Blossom PUT. Public hosts (e.g. nostr.build) return
 * 415 if every file is sent as application/octet-stream — they gate on MIME.
 */
function guessManifestFileContentType(filePath: string): string {
  const n = normalizeFilePath(filePath).toLowerCase();
  if (n === "robots.txt" || n.endsWith("/robots.txt")) {
    return "text/plain; charset=utf-8";
  }
  const ext = extOf(n);
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json";
    case ".webmanifest":
      return "application/manifest+json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/vnd.microsoft.icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
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

/** BUD-11 optional `server` tag — hostname of configured Blossom (lowercase domain only). */
function blossomServerTagForAuth(): string[] | undefined {
  try {
    const raw = (
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_BLOSSOM_URL
        ? process.env.NEXT_PUBLIC_BLOSSOM_URL
        : ""
    ).trim();
    const base = raw.length > 0 ? raw : "https://blossom.band";
    const u = base.startsWith("http") ? base : `https://${base}`;
    const host = new URL(u.replace(/\/$/, "")).hostname;
    if (host) return ["server", host.toLowerCase()];
  } catch {
    /* ignore */
  }
  return undefined;
}

function buildUnsignedBlossomUploadAuth(params: {
  pubkeyHex: string;
  sha256Hex: string;
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
  const tags: string[][] = [
    ["t", "upload"],
    ["expiration", String(now + (params.expiresInSeconds ?? 900))],
    ["x", params.sha256Hex.toLowerCase()],
  ];
  const srv = blossomServerTagForAuth();
  if (srv) tags.push(srv);
  return {
    kind: 24242,
    created_at: now,
    pubkey: params.pubkeyHex.toLowerCase(),
    tags,
    content: "gittr Pages: upload static site file (Blossom)",
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

function bytesFromGitFileContentJson(data: GitFileContentJson): Uint8Array | null {
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

/**
 * Resolve file bytes: localStorage → optional direct HTTPS URL → git source proxy → bridge file API.
 */
async function resolveManifestFileBytes(
  file: MergedManifestFile,
  ctx: {
    gitSourceUrl?: string;
    defaultBranch: string;
    ownerPubkeyHex: string;
    repo: string;
  }
): Promise<Uint8Array | null> {
  const local = repoFileContentToBytes(file.content, file.isBinary);
  if (local && local.length > 0) return local;

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
    const fromBridge = await fetchFileFromBridge(
      file.path,
      ctx.ownerPubkeyHex.toLowerCase(),
      ctx.repo,
      ctx.defaultBranch
    );
    if (fromBridge && fromBridge.length > 0) return fromBridge;
  }

  return null;
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
  | { ok: true; manifestEventId: string; pathCount: number; confirmed: boolean }
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

  const merged = mergeRepoFilesForManifest(entity, repo);
  const resolveCtx = {
    gitSourceUrl: gitSourceUrl?.trim() || undefined,
    defaultBranch,
    ownerPubkeyHex,
    repo,
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
    `Preparing ${manifestPaths.length} path(s) for Blossom (max ${MAX_FILES}, ${Math.round(
      MAX_TOTAL_BYTES / 1e6
    )} MB total)…`
  );

  let count = 0;
  for (const file of manifestPaths) {
    if (count >= MAX_FILES) {
      return {
        ok: false,
        error: `Too many static files (>${MAX_FILES}). Remove large trees from the manifest set.`,
      };
    }
    const bytes = await resolveManifestFileBytes(file, resolveCtx);
    if (!bytes || bytes.length === 0) {
      continue;
    }
    if (bytes.length > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `File too large for Blossom upload: ${file.path} (${bytes.length} bytes). Max per file is ${MAX_FILE_BYTES}.`,
      };
    }
    if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: `Total static payload exceeds ${MAX_TOTAL_BYTES} bytes. Trim assets or use fewer files.`,
      };
    }

    const sha256 = await sha256Hex(bytes);
    const webPath = toWebAbsolutePath(file.path);

    let auth = buildUnsignedBlossomUploadAuth({
      pubkeyHex: signerPk,
      sha256Hex: sha256,
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

    const uploadPayload = JSON.stringify({
      authEvent: signedAuth,
      contentBase64: bytesToBase64(bytes),
      sha256,
      contentType: guessManifestFileContentType(file.path),
    });

    let uploadOk = false;
    let lastUploadErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        onProgress?.(
          `Blossom upload retry ${attempt}/3 for ${webPath} (transient error)…`
        );
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }

      const proxyRes = await fetch("/api/gittr-pages/blossom-proxy-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: uploadPayload,
      });

      const proxyJson = (await proxyRes.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        body?: string;
      };

      if (proxyRes.ok) {
        uploads.push({ webPath, sha256 });
        totalBytes += bytes.length;
        count++;
        onProgress?.(`Uploaded ${webPath} (${count}/${manifestPaths.length})`);
        uploadOk = true;
        break;
      }

      const detail = proxyJson.body
        ? ` — ${String(proxyJson.body).slice(0, 160)}`
        : "";
      lastUploadErr = `Blossom upload failed for ${webPath}: ${
        proxyJson.error || proxyRes.status
      }${proxyJson.reason ? ` (${proxyJson.reason})` : ""}${detail}`;

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

  const blossomConfigured = (
    process.env.NEXT_PUBLIC_BLOSSOM_URL || "https://blossom.band"
  )
    .trim()
    .replace(/\/$/, "");
  const serverTagUrl = blossomConfigured.startsWith("http")
    ? blossomConfigured
    : `https://${blossomConfigured}`;

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

  return {
    ok: true,
    manifestEventId: manifest.id,
    pathCount: uploads.length,
    confirmed: pub.confirmed,
  };
}
