/**
 * Outbound git/HTTP URL safety for clone, import, and file-fetch APIs.
 * Blocks localhost, private LAN, link-local, and metadata hostnames.
 * Optionally resolves DNS and re-checks resolved addresses (anti-rebinding).
 */
import { promises as dns } from "dns";

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254",
]);

export function hostnameLooksPrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (METADATA_HOSTS.has(h)) return true;
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // IPv6 ULA / link-local (hostname may be bare or bracketed)
  const bare = h.replace(/^\[|\]$/g, "");
  if (/^fe80:/i.test(bare) || /^f[cd][0-9a-f]{2}:/i.test(bare)) return true;
  return false;
}

function isPrivateOrLocalIp(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr) return true;
  if (addr === "::1" || addr === "0.0.0.0") return true;
  if (addr.startsWith("127.")) return true;
  if (/^10\./.test(addr)) return true;
  if (/^192\.168\./.test(addr)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) return true;
  if (/^169\.254\./.test(addr)) return true;
  if (/^fe80:/i.test(addr) || /^f[cd][0-9a-f]{2}:/i.test(addr)) return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 etc.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return isPrivateOrLocalIp(mapped[1]);
  return false;
}

/**
 * Normalize SSH / git:// remotes to an https URL for parsing only.
 */
export function previewHttpUrlForSafety(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (t.startsWith("file:") || t.startsWith("/") || t.startsWith("~")) {
    return null;
  }
  if (t.startsWith("git@")) {
    const m = t.match(/^git@([^:]+):(.+)$/);
    if (!m) return null;
    return `https://${m[1]}/${m[2]}`;
  }
  const sshStyle = t.match(/^[^@\s]+@([^:]+):(.+)$/);
  if (sshStyle && !t.includes("://")) {
    return `https://${sshStyle[1]}/${sshStyle[2]}`;
  }
  if (t.startsWith("git://")) {
    return t.replace(/^git:\/\//, "https://");
  }
  if (!/^https?:\/\//i.test(t)) {
    return `https://${t}`;
  }
  return t;
}

function pathLooksLikeRepo(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  // owner/repo or npub1…/repo (GRASP) — at least two segments
  return parts.length >= 2;
}

export type SafeRemoteUrlOptions = {
  /** When true, require /owner/repo-style path (default true for git remotes). */
  requireRepoPath?: boolean;
  /** When true, resolve DNS and reject private A/AAAA (default true). */
  resolveDns?: boolean;
};

/**
 * Sync hostname/protocol checks only (no DNS). Prefer assertSafeOutboundGitUrl.
 */
export function isSafeOutboundGitUrlSync(
  raw: string,
  options: SafeRemoteUrlOptions = {}
): boolean {
  const requireRepoPath = options.requireRepoPath !== false;
  try {
    const preview = previewHttpUrlForSafety(raw);
    if (!preview) return false;
    const u = new URL(preview);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (hostnameLooksPrivateOrLocal(u.hostname)) return false;
    if (requireRepoPath && !pathLooksLikeRepo(u.pathname)) return false;
    // Block userinfo tricks that some SSRF scanners use
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

export async function assertSafeOutboundGitUrl(
  raw: string,
  options: SafeRemoteUrlOptions = {}
): Promise<{ ok: true; previewUrl: string } | { ok: false; error: string }> {
  const resolveDns = options.resolveDns !== false;
  if (!isSafeOutboundGitUrlSync(raw, options)) {
    return {
      ok: false,
      error: "Remote URL is invalid or targets a private/local host",
    };
  }
  const preview = previewHttpUrlForSafety(raw)!;
  if (!resolveDns) return { ok: true, previewUrl: preview };

  try {
    const hostname = new URL(preview).hostname;
    // Skip DNS for literal IPs — already checked above
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
      if (isPrivateOrLocalIp(hostname)) {
        return { ok: false, error: "Remote URL resolves to a private address" };
      }
      return { ok: true, previewUrl: preview };
    }
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!results.length) {
      return { ok: false, error: "Remote host did not resolve" };
    }
    for (const r of results) {
      if (isPrivateOrLocalIp(r.address)) {
        return {
          ok: false,
          error: "Remote URL resolves to a private or link-local address",
        };
      }
    }
    return { ok: true, previewUrl: preview };
  } catch (err: any) {
    return {
      ok: false,
      error: `Remote host DNS check failed: ${err?.message || "unknown"}`,
    };
  }
}

/**
 * Allow only relative GitHub REST paths we actually use (no open proxy).
 */
export function assertSafeGitHubApiEndpoint(
  endpoint: string
): { ok: true; path: string } | { ok: false; error: string } {
  const raw = String(endpoint || "").trim();
  if (!raw || raw.length > 512) {
    return { ok: false, error: "endpoint too long or empty" };
  }
  if (
    raw.includes("://") ||
    raw.includes("\\") ||
    raw.includes("..") ||
    raw.includes("@") ||
    raw.includes("//")
  ) {
    return { ok: false, error: "endpoint contains forbidden characters" };
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  // Strip query for pattern match; allow ? only for GitHub pagination params later
  const pathOnly = path.split("?")[0] || path;

  const allowed =
    /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/(?:commits|git\/trees|contents|releases|issues|pulls|branches|tags|languages|contributors|compare|git\/blobs|git\/refs|git\/commits)(?:\/.*)?)?$/.test(
      pathOnly
    ) || /^\/users\/[A-Za-z0-9_.-]+\/keys$/.test(pathOnly);

  if (!allowed) {
    return { ok: false, error: "endpoint not in allowlist" };
  }

  // Re-attach query if present and only uses safe chars
  const qIdx = path.indexOf("?");
  if (qIdx >= 0) {
    const qs = path.slice(qIdx + 1) || "";
    if (!/^[A-Za-z0-9_=&%.+-]*$/.test(qs)) {
      return { ok: false, error: "endpoint query not allowed" };
    }
  }

  return { ok: true, path };
}
