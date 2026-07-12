/**
 * Fetch wrapper for bridge read APIs (files, file-content, refs, commits,
 * clone). Public repos behave exactly like plain fetch. When the server
 * answers 401/403 (private repo), it retries once with a signed Nostr auth
 * header so owners and contributors can read their own private repos.
 */
import { getBridgeAuthHeaders } from "./bridge-auth";
import { resolveNostrSigner } from "./signer";

export async function fetchBridgeRead(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }
  if (typeof window === "undefined") {
    return response;
  }
  try {
    const signer = await resolveNostrSigner({ waitForRemote: false });
    if (!signer) return response;
    const pubkey = await signer.getPublicKey();
    if (!pubkey) return response;
    const authHeaders = await getBridgeAuthHeaders(pubkey, signer.signEvent);
    const headers = new Headers(init.headers || {});
    authHeaders.forEach((value, key) => headers.set(key, value));
    return await fetch(input, { ...init, headers });
  } catch {
    return response;
  }
}
