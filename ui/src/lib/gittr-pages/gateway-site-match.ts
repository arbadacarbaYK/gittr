import { getPagesHostname } from "@/lib/nsite/nsite-url";

/**
 * True when a gateway status row is this repo's named/root site.
 *
 * Do NOT use substring includes(dTag): for dTag "gittr", every
 * `*.pages.gittr.space` URL contains "gittr" and false-positives.
 */
export function gatewaySiteMatchesRepo(
  siteUrl: string | undefined | null,
  namedUrl: string,
  dTag: string,
  pagesHost = "pages.gittr.space"
): boolean {
  const u = (siteUrl || "").replace(/\/$/, "").toLowerCase();
  if (!u) return false;
  const want = namedUrl.replace(/\/$/, "").toLowerCase();
  if (want && u === want) return true;

  const d = (dTag || "").trim().toLowerCase();
  if (!d) return false;

  let host = pagesHost.toLowerCase();
  try {
    host = getPagesHostname(
      pagesHost.startsWith("http") ? pagesHost : `https://${pagesHost}`
    ).toLowerCase();
  } catch {
    /* keep */
  }

  // Named site host: {pubkeyB36}{dTag}.{pagesHost}
  try {
    const hostname = new URL(u).hostname.toLowerCase();
    if (hostname === `${d}.${host}`) return true;
    if (hostname.endsWith(`${d}.${host}`) && hostname.length > d.length + host.length + 1) {
      return true;
    }
  } catch {
    if (u.endsWith(`${d}.${host}`)) return true;
  }
  return false;
}
