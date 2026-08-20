import { isGraspServer } from "./grasp-servers";

/**
 * True for https(s) remotes that look like host/owner/repo.
 * Allows `/npub1…/repo` on non-GRASP hosts (home Freebox, self-hosted GRASP-shaped
 * paths) so they can be listed via `/api/git/repo-files`. Known GRASP hosts are
 * handled separately as nostr-git.
 */
export function isGenericHttpsGitRemoteUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    let u = raw.trim();
    const sshMatch = u.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      const [, host, path] = sshMatch;
      u = `https://${host}/${path}`;
    } else if (u.startsWith("git://")) {
      u = u.replace(/^git:\/\//, "https://");
    }
    if (!/^https?:\/\//i.test(u)) {
      u = `https://${u}`;
    }
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      host === "0.0.0.0"
    ) {
      return false;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    const ownerSeg = parts[0];
    if (!ownerSeg) return false;
    if (/^npub1[a-z0-9]+$/i.test(ownerSeg)) {
      if (isGraspServer(u) || isGraspServer(host)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Upstream URLs we can refetch or list via server-side git (GitHub/GitLab/Codeberg or generic HTTPS). */
export function isRefetchableUpstreamSourceUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  const t = raw.trim();
  if (
    t.includes("github.com") ||
    t.includes("gitlab.com") ||
    t.includes("codeberg.org")
  ) {
    return true;
  }
  return isGenericHttpsGitRemoteUrl(t);
}
