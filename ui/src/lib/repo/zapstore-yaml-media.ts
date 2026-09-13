/**
 * Zapstore `zapstore.yaml` icon + screenshot (`images:`) refs.
 * `zsp publish` uploads local files; gittr’s NIP-82 announce copies HTTPS
 * URLs (or forge-raw rewrites of repo-relative paths) onto kind 32267.
 */
import { normalizeSoftwareIconUrl } from "../nostr/nip82-software";
import { parseGiteaCompatibleRepo } from "../repos/gitea-forge";
import {
  extractKnownForgeRepo,
  forgeRawLogoUrl,
} from "../repos/resolve-repo-display-icon";

export const ZAPSTORE_YAML_NAMES = ["zapstore.yaml", "zapstore.yml"] as const;
export const ZAPSTORE_SCREENSHOT_MAX = 12;

export type ZapstoreYamlMedia = {
  icon?: string;
  images: string[];
};

function unquoteYamlScalar(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  if (v.startsWith("#")) return "";
  const hash = v.search(/\s+#/);
  if (hash >= 0) v = v.slice(0, hash).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

function splitInlineYamlList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      const v = unquoteYamlScalar(cur);
      if (v) out.push(v);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const last = unquoteYamlScalar(cur);
  if (last) out.push(last);
  return out;
}

/**
 * Small subset parser for Zapstore’s yaml (icon + images). Avoids shipping
 * a full YAML parser into the announce UI bundle.
 */
export function parseZapstoreYamlMedia(text: string): ZapstoreYamlMedia {
  const images: string[] = [];
  let icon: string | undefined;
  let inImages = false;
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (inImages && indent === 0 && !trimmed.startsWith("-")) {
      inImages = false;
    }
    const iconMatch = trimmed.match(/^icon:\s*(.*)$/i);
    if (iconMatch && indent === 0) {
      const v = unquoteYamlScalar(iconMatch[1] || "");
      if (v) icon = v;
      inImages = false;
      continue;
    }
    const inline = trimmed.match(/^images:\s*\[(.*)\]\s*$/i);
    if (inline && indent === 0) {
      for (const v of splitInlineYamlList(inline[1] || "")) images.push(v);
      inImages = false;
      continue;
    }
    if (/^images:\s*$/i.test(trimmed) && indent === 0) {
      inImages = true;
      continue;
    }
    if (inImages && trimmed.startsWith("-")) {
      const v = unquoteYamlScalar(trimmed.replace(/^-/, "").trim());
      if (v) images.push(v);
    }
  }
  return { icon, images };
}

function sanitizeRepoRelativePath(raw: string): string | undefined {
  let path = raw.trim().replace(/\\/g, "/");
  if (!path || path.includes("://") || path.includes("..")) return undefined;
  path = path.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!path || path.length > 400) return undefined;
  if (/^(javascript|data|file|blob):/i.test(path)) return undefined;
  return path;
}

function giteaRawFileUrl(
  origin: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  const encodedPath = filePath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const b = encodeURIComponent(branch || "main");
  return `${origin.replace(
    /\/+$/,
    ""
  )}/${owner}/${repo}/raw/branch/${b}/${encodedPath}`;
}

export function resolveZapstoreRefToHttps(
  raw: string,
  args: {
    sourceUrl?: string | null;
    defaultBranch?: string | null;
  }
): string | undefined {
  const t = (raw || "").trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) return normalizeSoftwareIconUrl(t);
  const path = sanitizeRepoRelativePath(t);
  if (!path) return undefined;
  const branch = (args.defaultBranch || "main").trim() || "main";
  const known = extractKnownForgeRepo(args.sourceUrl || "");
  if (known) {
    return normalizeSoftwareIconUrl(forgeRawLogoUrl(known, path, branch));
  }
  const gitea = parseGiteaCompatibleRepo(args.sourceUrl || "");
  if (gitea) {
    return normalizeSoftwareIconUrl(
      giteaRawFileUrl(gitea.origin, gitea.owner, gitea.repo, branch, path)
    );
  }
  return undefined;
}

/** Raw HTTPS URLs to try for the repo-root Zapstore file (yaml then yml). */
export function zapstoreYamlCandidateRawUrls(args: {
  sourceUrl: string;
  defaultBranch?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const branches = [(args.defaultBranch || "").trim(), "main", "master"].filter(
    (b, i, all) => b && all.indexOf(b) === i
  );
  for (const branch of branches) {
    for (const name of ZAPSTORE_YAML_NAMES) {
      const u = resolveZapstoreRefToHttps(name, {
        sourceUrl: args.sourceUrl,
        defaultBranch: branch,
      });
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

export function resolveZapstoreMediaHttps(args: {
  media: ZapstoreYamlMedia;
  sourceUrl: string;
  defaultBranch?: string | null;
}): { icon?: string; screenshots: string[] } {
  const ctx = {
    sourceUrl: args.sourceUrl,
    defaultBranch: args.defaultBranch,
  };
  const screenshots: string[] = [];
  const seen = new Set<string>();
  for (const raw of args.media.images) {
    const u = resolveZapstoreRefToHttps(raw, ctx);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    screenshots.push(u);
    if (screenshots.length >= ZAPSTORE_SCREENSHOT_MAX) break;
  }
  const icon = args.media.icon
    ? resolveZapstoreRefToHttps(args.media.icon, ctx)
    : undefined;
  return { icon, screenshots };
}

export function parseHttpsUrlLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(text || "").split(/\r?\n/)) {
    const u = normalizeSoftwareIconUrl(line.trim());
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= ZAPSTORE_SCREENSHOT_MAX) break;
  }
  return out;
}
