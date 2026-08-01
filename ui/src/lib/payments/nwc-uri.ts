/**
 * Parse nostr+walletconnect:// URIs (NIP-47).
 *
 * Alby and others often emit multiple `relay=` params. We keep all of them and
 * try in order — many clients only read the first and soft-fail if that one is down.
 *
 * Transport is ALWAYS from the URI (never the app's social relay pool).
 */

export type ParsedNwcConnection = {
  walletPubkey: string;
  /** First / preferred relay (compat) */
  relay: string;
  /** All relays from the URI, deduped, wss/ws only */
  relays: string[];
  secret: string;
  lud16?: string;
};

export function parseNwcConnectionUri(nwcUri: string): ParsedNwcConnection {
  const trimmed = nwcUri.trim();
  if (
    !trimmed.startsWith("nostr+walletconnect://") &&
    !trimmed.startsWith("nostr+walletconnect:")
  ) {
    throw new Error("NWC URI must start with 'nostr+walletconnect://'");
  }

  const normalized = trimmed.replace(/^nostr\+walletconnect:/, "http:");
  const uri = new URL(normalized);
  const walletPubkey = (
    uri.hostname || uri.pathname.replace(/^\/+/, "").replace(/\/$/, "")
  ).toLowerCase();
  const secret = uri.searchParams.get("secret") || "";
  const lud16 = uri.searchParams.get("lud16") || undefined;

  const relays = [
    ...new Set(
      uri.searchParams
        .getAll("relay")
        .map((r) => r.trim())
        .filter((r) => r.startsWith("wss://") || r.startsWith("ws://"))
    ),
  ];

  if (!walletPubkey || walletPubkey.length !== 64) {
    throw new Error("Invalid NWC URI: missing or invalid wallet pubkey");
  }
  if (relays.length === 0) {
    throw new Error("Invalid NWC URI: missing relay");
  }
  if (!secret) {
    throw new Error("Invalid NWC URI: missing secret");
  }

  return {
    walletPubkey,
    relay: relays[0]!,
    relays,
    secret,
    lud16: lud16 || undefined,
  };
}
