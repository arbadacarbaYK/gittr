/**
 * Bridge Push Authentication Helper
 * Provides NIP-98 style auth for the UI using NIP-07 signer
 */

import { getEventHash } from "nostr-tools";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || '';

/**
 * Get authentication headers for bridge push using NIP-07 signer
 * @param pubkey - User's hex pubkey
 * @param signer - NIP-07 signer function (window.nostr.signEvent)
 */
export async function getBridgeAuthHeaders(
  pubkey: string, 
  signer: (event: any) => Promise<any>
): Promise<Headers> {
  // Step 1: Get challenge from bridge
  const challengeRes = await fetch(`${BRIDGE_URL}/api/nostr/repo/push-challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Failed to get challenge: ${challengeRes.status}`);
  }
  const { challenge } = await challengeRes.json();

  // Step 2: Sign the challenge with NIP-07
  const created_at = Math.floor(Date.now() / 1000);
  const unsignedEvent = {
    pubkey,
    kind: 24242,
    created_at,
    tags: [["challenge", challenge]],
    content: "gittr bridge auth"
  };

  // Get the event hash and sign using NIP-07
  const hash = getEventHash(unsignedEvent);
  const signed = await signer({ ...unsignedEvent, id: hash });

  // Step 3: Create NIP-98 style auth header
  const authPayload = {
    pubkey,
    sig: signed.sig,
    created_at
  };

  const authHeader = Buffer.from(JSON.stringify(authPayload)).toString("base64");

  return new Headers({
    "Authorization": `Nostr ${authHeader}`
  });
}

/**
 * Get challenge from bridge (for debugging/custom implementations)
 */
export async function getBridgeChallenge(): Promise<string> {
  const challengeRes = await fetch(`${BRIDGE_URL}/api/nostr/repo/push-challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Failed to get challenge: ${challengeRes.status}`);
  }
  const { challenge } = await challengeRes.json();
  return challenge;
}
