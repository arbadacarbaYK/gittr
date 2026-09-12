import { getPagesHostname } from "../nsite/nsite-url";

/**
 * True when a gateway status row is this repo's named/root site.
 *
 * Do NOT use substring includes(dTag): for dTag "gittr", every
 * `*.pages.gittr.space` URL contains "gittr" and false-positives.
 */
function hostnameMatchesNamedDTag(
  siteUrl: string,
  dTag: string,
  pagesHost: string
): boolean {
  const d = dTag.trim().toLowerCase();
  if (!d) return false;
  let host = pagesHost.toLowerCase();
  try {
    host = getPagesHostname(
      pagesHost.startsWith("http") ? pagesHost : `https://${pagesHost}`
    ).toLowerCase();
  } catch {
    /* keep */
  }
  try {
    const hostname = new URL(siteUrl).hostname.toLowerCase();
    if (hostname === `${d}.${host}`) return true;
    if (
      hostname.endsWith(`${d}.${host}`) &&
      hostname.length > d.length + host.length + 1
    ) {
      return true;
    }
  } catch {
    if (siteUrl.endsWith(`${d}.${host}`)) return true;
  }
  return false;
}

export function gatewaySiteMatchesRepo(
  siteUrl: string | undefined | null,
  namedUrl: string,
  dTag: string,
  pagesHost = "pages.gittr.space",
  extra?: { rootUrl?: string | null; extraDTags?: string[] }
): boolean {
  const u = (siteUrl || "").replace(/\/$/, "").toLowerCase();
  if (!u) return false;
  const want = namedUrl.replace(/\/$/, "").toLowerCase();
  if (want && u === want) return true;
  const rootWant = (extra?.rootUrl || "").replace(/\/$/, "").toLowerCase();
  if (rootWant && u === rootWant) return true;

  const tags = [dTag, ...(extra?.extraDTags || [])]
    .map((t) => (t || "").trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const d of tags) {
    if (seen.has(d)) continue;
    seen.add(d);
    if (hostnameMatchesNamedDTag(u, d, pagesHost)) return true;
  }
  return false;
}
