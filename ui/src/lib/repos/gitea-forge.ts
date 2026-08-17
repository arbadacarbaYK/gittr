/**
 * Forgejo / Gitea REST (`/api/v1`) — Codeberg is Forgejo; self-hosted Forgejo
 * speaks the same API. GitHub and GitLab.com stay on their own clients.
 */
import {
  detectGitForge,
  normalizeGitCloneUrl,
} from "../utils/detect-git-forge";

export type GiteaCompatibleKind = "codeberg" | "gitea";

export type GiteaCompatibleRepo = {
  origin: string;
  host: string;
  owner: string;
  repo: string;
  kind: GiteaCompatibleKind;
};

function httpsOrigin(host: string): string {
  return `https://${host.replace(/^www\./, "")}`;
}

/**
 * Parse a clone/web URL that can speak Gitea/Forgejo `/api/v1`.
 * Includes Codeberg, hosts named gitea/forgejo, and other HTTPS owner/repo
 * forges (API calls no-op if the host is not actually Gitea).
 */
export function parseGiteaCompatibleRepo(
  sourceUrl: string | null | undefined
): GiteaCompatibleRepo | null {
  const raw = String(sourceUrl || "").trim();
  if (!raw) return null;
  const detected = detectGitForge(raw);
  if (
    detected.type === "github" ||
    detected.type === "gitlab" ||
    detected.type === "unknown"
  ) {
    return null;
  }

  let href = normalizeGitCloneUrl(raw) || raw;
  if (href.startsWith("git@")) {
    const m = href.match(/^git@([^:]+):(.+)$/);
    if (!m?.[1] || !m[2]) return null;
    href = `https://${m[1]}/${m[2].replace(/\.git$/i, "")}`;
  } else if (!/^https?:\/\//i.test(href)) {
    href = `https://${href}`;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host === "localhost" || host.endsWith(".local")) return null;
  if (
    host.includes("gittr.space") ||
    host.includes("ngit.dev") ||
    host.includes("shakespeare")
  ) {
    return null;
  }

  const parts = url.pathname
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  if (!owner || !repo || /^npub1[a-z0-9]+$/i.test(owner)) return null;

  const kind: GiteaCompatibleKind =
    detected.type === "codeberg" ? "codeberg" : "gitea";
  return {
    origin: httpsOrigin(host),
    host,
    owner,
    repo,
    kind,
  };
}

export function giteaApiRepoBase(parsed: GiteaCompatibleRepo): string {
  return `${parsed.origin}/api/v1/repos/${encodeURIComponent(
    parsed.owner
  )}/${encodeURIComponent(parsed.repo)}`;
}
