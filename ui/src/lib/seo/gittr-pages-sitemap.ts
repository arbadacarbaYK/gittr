import { parseGatewayManifestsJson } from "@/lib/gittr-pages/gateway-manifests-json";
import { filterGatewaySitesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";
import { getPagesHostname } from "@/lib/nsite/nsite-url";

const FETCH_TIMEOUT_MS = 25_000;
/** Cap Pages host URLs in sitemap (manifests can list many sites). */
const MAX_PAGES_URLS = 12_000;

function normalizePublicUrl(siteUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") {
    return u.origin;
  }
  return `${u.origin}${path}`;
}

function isUnderPagesHost(hostname: string, allowedHost: string): boolean {
  const h = hostname.toLowerCase();
  const a = allowedHost.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

/**
 * Live gittr Pages / nsite URLs from the gateway `GET /status/manifests.json`.
 * Hostnames must match the configured Pages origin (avoids injecting arbitrary URLs).
 */
export async function fetchGittrPagesSitemapEntries(
  pagesBaseRaw: string
): Promise<Array<{ url: string; lastModified: Date }>> {
  if (
    process.env.SITEMAP_SKIP_GITTR_PAGES === "1" ||
    process.env.SITEMAP_SKIP_GITTR_PAGES === "true"
  ) {
    return [];
  }

  const pagesBase = (pagesBaseRaw || "https://pages.gittr.space").replace(
    /\/$/,
    ""
  );
  let allowedHost: string;
  try {
    allowedHost = getPagesHostname(pagesBase);
  } catch {
    return [];
  }

  const manifestUrl = `${pagesBase}/status/manifests.json`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(manifestUrl, {
      signal: ac.signal,
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return [];
    }
    const raw: unknown = await res.json();
    const { sites } = parseGatewayManifestsJson(raw, pagesBase);
    const sitesFiltered = filterGatewaySitesByPublisherBlocklist(sites);
    const out: Array<{ url: string; lastModified: Date }> = [];

    for (const s of sitesFiltered) {
      if (out.length >= MAX_PAGES_URLS) break;
      let host: string;
      try {
        host = new URL(s.siteUrl).hostname;
      } catch {
        continue;
      }
      if (!isUnderPagesHost(host, allowedHost)) continue;

      const url = normalizePublicUrl(s.siteUrl);
      if (!url) continue;

      const ts = s.updatedIso ? Date.parse(s.updatedIso) : NaN;
      const lastModified = Number.isFinite(ts) ? new Date(ts) : new Date();

      out.push({ url, lastModified });
    }

    return out;
  } catch {
    return [];
  }
}
