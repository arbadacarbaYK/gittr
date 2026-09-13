/**
 * Server-side fetch of a linked forge’s repo-root zapstore.yaml / .yml.
 * Only those two filenames — never a user-controlled path.
 */
import { extractKnownForgeRepo } from "../repos/resolve-repo-display-icon";

import {
  ZAPSTORE_YAML_NAMES,
  parseZapstoreYamlMedia,
  resolveZapstoreMediaHttps,
  zapstoreYamlCandidateRawUrls,
} from "./zapstore-yaml-media";

export const ZAPSTORE_YAML_MAX_BYTES = 80 * 1024;
export const ZAPSTORE_YAML_FETCH_MS = 8000;

export type ZapstoreYamlFetchOk = {
  ok: true;
  found: boolean;
  fileName?: string;
  icon?: string;
  screenshots: string[];
};

export type ZapstoreYamlFetchErr = {
  ok: false;
  code: "missing_source" | "unsupported_forge" | "upstream";
  message: string;
};

export type ZapstoreYamlFetchResult =
  | ZapstoreYamlFetchOk
  | ZapstoreYamlFetchErr;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space-zapstore-yaml",
  };
  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function publicRawHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/plain, text/yaml, application/yaml, */*",
    "User-Agent": "gittr-space-zapstore-yaml",
  };
  try {
    const host = new URL(url).hostname.toLowerCase();
    const github =
      host === "github.com" ||
      host.endsWith(".githubusercontent.com") ||
      host === "api.github.com";
    const token = process.env.GITHUB_PLATFORM_TOKEN || "";
    if (github && token && host === "api.github.com") {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    /* ignore */
  }
  return headers;
}

function remainingMs(deadline: number): number {
  return Math.max(250, deadline - Date.now());
}

async function readCappedText(
  res: Response,
  maxBytes: number
): Promise<string | undefined> {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) return undefined;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return undefined;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("json")) {
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as {
        encoding?: string;
        content?: string;
        message?: string;
      };
      if (typeof parsed.content === "string" && parsed.encoding === "base64") {
        const decoded = Buffer.from(parsed.content, "base64");
        if (decoded.byteLength > maxBytes) return undefined;
        return decoded.toString("utf8");
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  return buf.toString("utf8");
}

async function fetchText(
  url: string,
  deadline: number,
  headers: Record<string, string>
): Promise<string | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), remainingMs(deadline));
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers,
    });
    if (!res.ok) return undefined;
    return await readCappedText(res, ZAPSTORE_YAML_MAX_BYTES);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function githubApiContentUrls(
  sourceUrl: string,
  defaultBranch?: string | null
): Array<{ url: string; fileName: string }> {
  const forge = extractKnownForgeRepo(sourceUrl);
  if (!forge || forge.hostname !== "github.com") return [];
  const branches = [(defaultBranch || "").trim(), "main", "master"].filter(
    (b, i, all) => b && all.indexOf(b) === i
  );
  const out: Array<{ url: string; fileName: string }> = [];
  for (const branch of branches) {
    for (const fileName of ZAPSTORE_YAML_NAMES) {
      const ref = encodeURIComponent(branch);
      out.push({
        fileName,
        url: `https://api.github.com/repos/${forge.owner}/${forge.repo}/contents/${fileName}?ref=${ref}`,
      });
    }
  }
  return out;
}

function fileNameFromRawUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".yml")) return "zapstore.yml";
  return "zapstore.yaml";
}

export async function fetchZapstoreYamlFromForge(args: {
  sourceUrl: string;
  defaultBranch?: string | null;
}): Promise<ZapstoreYamlFetchResult> {
  const sourceUrl = (args.sourceUrl || "").trim();
  if (!sourceUrl) {
    return {
      ok: false,
      code: "missing_source",
      message:
        "Link a forge remote first (GitHub, Codeberg, GitLab, or Forgejo).",
    };
  }

  const deadline = Date.now() + ZAPSTORE_YAML_FETCH_MS;
  const apiTries = githubApiContentUrls(sourceUrl, args.defaultBranch);
  const rawTries = zapstoreYamlCandidateRawUrls({
    sourceUrl,
    defaultBranch: args.defaultBranch,
  });
  if (apiTries.length === 0 && rawTries.length === 0) {
    return {
      ok: false,
      code: "unsupported_forge",
      message:
        "Could not map this source URL to a public forge file. Use GitHub, GitLab, Codeberg, or Forgejo.",
    };
  }

  const tryParse = (
    text: string,
    fileName: string
  ): ZapstoreYamlFetchOk | undefined => {
    const media = parseZapstoreYamlMedia(text);
    const resolved = resolveZapstoreMediaHttps({
      media,
      sourceUrl,
      defaultBranch: args.defaultBranch,
    });
    return {
      ok: true,
      found: true,
      fileName,
      icon: resolved.icon,
      screenshots: resolved.screenshots,
    };
  };

  for (const tryApi of apiTries) {
    if (Date.now() >= deadline) break;
    const text = await fetchText(tryApi.url, deadline, githubHeaders());
    if (!text) continue;
    const parsed = tryParse(text, tryApi.fileName);
    if (parsed) return parsed;
  }

  for (const url of rawTries) {
    if (Date.now() >= deadline) break;
    const text = await fetchText(url, deadline, publicRawHeaders(url));
    if (!text) continue;
    const parsed = tryParse(text, fileNameFromRawUrl(url));
    if (parsed) return parsed;
  }

  return { ok: true, found: false, screenshots: [] };
}
