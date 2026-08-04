/**
 * Push NIP-34 PR ref (refs/nostr/<event-id>) to the bridge bare repo.
 * Requires the same challenge-bound Nostr auth as bridge push.
 */
import { getBridgeAuthHeaders } from "./bridge-auth";

export interface PushPrRefParams {
  ownerPubkey: string;
  repo: string;
  eventId: string;
  commitId?: string;
  sourceRef?: string;
  /** Hex pubkey of the signer (required for auth). */
  pubkey?: string;
  /** NIP-07 / Amber / nsec signer. */
  signer?: (event: any) => Promise<any>;
}

export interface PushPrRefResult {
  success: boolean;
  refName?: string;
  commitId?: string;
  error?: string;
}

export async function pushPrRef({
  ownerPubkey,
  repo,
  eventId,
  commitId,
  sourceRef,
  pubkey,
  signer,
}: PushPrRefParams): Promise<PushPrRefResult> {
  if (!ownerPubkey || !repo || !eventId) {
    return {
      success: false,
      error: "Missing ownerPubkey, repo, or eventId",
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (pubkey && signer) {
      const authHeaders = await getBridgeAuthHeaders(pubkey, signer);
      const authorization = authHeaders.get("Authorization");
      const authEvent = authHeaders.get("X-Nostr-Auth-Event");
      if (authorization) headers["Authorization"] = authorization;
      if (authEvent) headers["X-Nostr-Auth-Event"] = authEvent;
    }

    const response = await fetch("/api/nostr/repo/push-ref", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ownerPubkey,
        repo,
        refName: `refs/nostr/${eventId}`,
        commitId,
        sourceRef,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        error: data.error || data.details || `Push ref failed (${response.status})`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      refName: data.refName,
      commitId: data.commitId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Push ref failed",
    };
  }
}
