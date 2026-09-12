import { nip19 } from "nostr-tools";

import { getPagesHostname } from "../nsite/nsite-url";
import { pubkeyHexToPubkeyB36 } from "../nsite/pubkey-base36";

/**
 * True when a gateway directory row belongs to this profile.
 *
 * Named gittr Pages hosts are `{pubkeyB36}{dTag}.pages.gittr.space`, not
 * `npub1…`. Matching only npub hostnames hid every named site on /{npub}.
 */
export function pageBelongsToOwner(
  site: { siteUrl?: string | null; authorPubkeyHex?: string | null },
  ownerHex: string,
  pagesHost = "pages.gittr.space"
): boolean {
  const h = ownerHex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) return false;

  const author = (site.authorPubkeyHex || "").toLowerCase().replace(/^0x/, "");
  if (author === h) return true;

  let hostname = "";
  try {
    hostname = new URL(String(site.siteUrl || "")).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;

  const first = hostname.split(".")[0]?.trim() ?? "";
  if (first.toLowerCase().startsWith("npub1")) {
    try {
      const decoded = nip19.decode(first);
      if (
        decoded.type === "npub" &&
        typeof decoded.data === "string" &&
        decoded.data.toLowerCase() === h
      ) {
        return true;
      }
    } catch {
      /* not an npub label */
    }
  }

  const b36 = pubkeyHexToPubkeyB36(h);
  if (!b36) return false;

  let host = pagesHost.toLowerCase();
  try {
    host = getPagesHostname(
      pagesHost.startsWith("http") ? pagesHost : `https://${pagesHost}`
    ).toLowerCase();
  } catch {
    /* keep */
  }

  return hostname.startsWith(b36) && hostname.endsWith(`.${host}`);
}
