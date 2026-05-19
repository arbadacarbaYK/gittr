import { nip19 } from "nostr-tools";

/** External profile page (njump.me) for npub or 64-char hex pubkey. */
export function nostrProfileViewerUrl(pubkeyOrNpub: string): string {
  const trimmed = pubkeyOrNpub.trim();
  if (trimmed.startsWith("npub1")) {
    return `https://njump.me/${trimmed}`;
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return `https://njump.me/${nip19.npubEncode(trimmed.toLowerCase())}`;
  }
  return `https://njump.me/${encodeURIComponent(trimmed)}`;
}
