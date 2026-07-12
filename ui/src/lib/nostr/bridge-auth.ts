/**
 * Bridge Push Authentication Helper
 * Provides NIP-98 style auth for the UI using NIP-07 signer
 */
import { getEventHash } from "nostr-tools";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "";
const AUTH_CACHE_TTL_SECONDS = 240; // Keep below backend 5 minute expiry window

type CachedBridgeAuth = {
  pubkey: string;
  created_at: number;
  header: string;
  /** base64 of the full signed kind-24242 auth event (verifiable server-side) */
  eventHeader?: string;
};

const memoryAuthCache = new Map<string, CachedBridgeAuth>();

function getStorageKey(pubkey: string): string {
  return `gittr_bridge_auth:${pubkey.toLowerCase()}`;
}

function readCachedAuth(pubkey: string): CachedBridgeAuth | null {
  const key = pubkey.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const cached = memoryAuthCache.get(key);
  if (cached && now - cached.created_at < AUTH_CACHE_TTL_SECONDS) {
    return cached;
  }

  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBridgeAuth;
    if (
      parsed &&
      parsed.pubkey?.toLowerCase() === key &&
      typeof parsed.created_at === "number" &&
      typeof parsed.header === "string" &&
      now - parsed.created_at < AUTH_CACHE_TTL_SECONDS
    ) {
      memoryAuthCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // Ignore malformed cache entries
  }
  return null;
}

function writeCachedAuth(auth: CachedBridgeAuth): void {
  const key = auth.pubkey.toLowerCase();
  memoryAuthCache.set(key, auth);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getStorageKey(key), JSON.stringify(auth));
  } catch {
    // Ignore storage quota/access errors
  }
}

/**
 * Get authentication headers for bridge push using NIP-07 signer
 * @param pubkey - User's hex pubkey
 * @param signer - NIP-07 signer function (window.nostr.signEvent)
 */
export async function getBridgeAuthHeaders(
  pubkey: string,
  signer: (event: any) => Promise<any>
): Promise<Headers> {
  const normalizedPubkey = pubkey.toLowerCase();
  const cached = readCachedAuth(normalizedPubkey);
  if (cached?.header) {
    const headers = new Headers({
      Authorization: `Nostr ${cached.header}`,
    });
    if (cached.eventHeader) {
      headers.set("X-Nostr-Auth-Event", cached.eventHeader);
    }
    return headers;
  }

  // Step 1: Get challenge from bridge
  const challengeRes = await fetch(
    `${BRIDGE_URL}/api/nostr/repo/push-challenge`
  );
  if (!challengeRes.ok) {
    throw new Error(`Failed to get challenge: ${challengeRes.status}`);
  }
  const { challenge } = await challengeRes.json();

  // Step 2: Sign the challenge with NIP-07
  const created_at = Math.floor(Date.now() / 1000);
  const unsignedEvent = {
    pubkey: normalizedPubkey,
    kind: 24242,
    created_at,
    tags: [["challenge", challenge]],
    content: "gittr bridge auth",
  };

  // Get the event hash and sign using NIP-07
  const hash = getEventHash(unsignedEvent);
  const signed = await signer({ ...unsignedEvent, id: hash });

  // Step 3: Create auth headers.
  // X-Nostr-Auth-Event carries the FULL signed event — the only header the
  // server can verify with real nostr-tools signature checks. The legacy
  // Authorization payload is kept for older deployments.
  const authPayload = {
    pubkey: normalizedPubkey,
    sig: signed.sig,
    created_at,
  };

  const authHeader = Buffer.from(JSON.stringify(authPayload)).toString(
    "base64"
  );
  // NIP-07/NIP-46 signers usually return the full signed event; fall back to
  // assembling one when only the signature comes back.
  const fullEvent =
    signed && signed.id && signed.sig && signed.pubkey
      ? signed
      : { ...unsignedEvent, id: hash, sig: signed.sig };
  const eventHeader = Buffer.from(JSON.stringify(fullEvent)).toString(
    "base64"
  );
  writeCachedAuth({
    pubkey: normalizedPubkey,
    created_at,
    header: authHeader,
    eventHeader,
  });

  return new Headers({
    Authorization: `Nostr ${authHeader}`,
    "X-Nostr-Auth-Event": eventHeader,
  });
}

/**
 * Get challenge from bridge (for debugging/custom implementations)
 */
export async function getBridgeChallenge(): Promise<string> {
  const challengeRes = await fetch(
    `${BRIDGE_URL}/api/nostr/repo/push-challenge`
  );
  if (!challengeRes.ok) {
    throw new Error(`Failed to get challenge: ${challengeRes.status}`);
  }
  const { challenge } = await challengeRes.json();
  return challenge;
}
