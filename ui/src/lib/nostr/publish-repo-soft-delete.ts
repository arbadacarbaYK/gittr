/**
 * Soft-delete a NIP-34 repository announce (kind 30617) and wipe the bridge bare.
 *
 * Settings historically cleared localStorage and navigated away while signing /
 * publish ran in a fire-and-forget IIFE — signer prompts (NIP-07 / Amber) were
 * aborted and only `gittr_deleted_repos` hid the repo. Relays kept the live announce.
 */
import {
  KIND_DELETION,
  buildUnsignedRepositoryEvent,
} from "@/lib/nostr/events";
import type { ResolvedNostrSigner } from "@/lib/nostr/signer";

import { getEventHash } from "nostr-tools";

export type SoftDeleteRepoInput = {
  repoName: string;
  description?: string;
  publicRead?: boolean;
  sourceUrl?: string;
  forkedFrom?: string;
  /** Prior live 30617 id for optional NIP-09 kind 5 `e` tag */
  priorEventId?: string;
};

export type SoftDeletePublishFns = {
  publish: (event: any, relays: string[]) => void;
  defaultRelays: string[];
  /** Logged-in pubkey hex (fallback when event.pubkey missing) */
  pubkey?: string | null;
};

export type SoftDeleteResult = {
  deletionEvent: any;
  bridgeStatus: "wiped" | "relay_only" | "error" | "skipped";
  bridgeDetail?: string;
  kind5Published: boolean;
};

async function signWithTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = 120000
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

/**
 * Sign soft-deleted 30617 via NIP-07 / Amber (NIP-46) / nsec, publish to relays,
 * POST bridge `/api/nostr/repo/event`. Awaits signing + bridge.
 */
export async function publishRepoSoftDelete(opts: {
  repo: SoftDeleteRepoInput;
  signer: ResolvedNostrSigner;
  pub: SoftDeletePublishFns;
}): Promise<SoftDeleteResult> {
  const { repo, signer, pub } = opts;
  const name = (repo.repoName || "").trim();
  if (!name) throw new Error("Missing repository name");

  const pubkeyHex = (
    (await signer.getPublicKey()) ||
    pub.pubkey ||
    ""
  ).toLowerCase();
  if (!pubkeyHex || !/^[0-9a-f]{64}$/.test(pubkeyHex)) {
    throw new Error("Cannot soft-delete: missing signer pubkey");
  }

  const unsigned = buildUnsignedRepositoryEvent(
    {
      repositoryName: name,
      name,
      publicRead: repo.publicRead !== false,
      publicWrite: false,
      description: repo.description,
      deleted: true,
      sourceUrl: repo.sourceUrl,
      forkedFrom: repo.forkedFrom,
    },
    pubkeyHex
  );
  unsigned.id = getEventHash(unsigned);

  const deletionEvent = await signWithTimeout(
    signer.signEvent(unsigned),
    signer.source === "remote"
      ? "Amber soft-delete sign"
      : "Soft-delete sign"
  );

  try {
    pub.publish(deletionEvent, pub.defaultRelays);
  } catch (e) {
    console.warn("[soft-delete] relay publish kickoff failed:", e);
  }

  let bridgeStatus: SoftDeleteResult["bridgeStatus"] = "skipped";
  let bridgeDetail: string | undefined;
  try {
    const bridgeResponse = await fetch("/api/nostr/repo/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deletionEvent),
    });
    const bridgeResult = (await bridgeResponse.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (!bridgeResponse.ok) {
      bridgeStatus = "error";
      bridgeDetail = bridgeResult?.error || `HTTP ${bridgeResponse.status}`;
    } else if (bridgeResult?.status === "relay_only") {
      bridgeStatus = "relay_only";
      bridgeDetail = bridgeResult?.error || "bridge unreachable";
    } else {
      bridgeStatus = "wiped";
      bridgeDetail = bridgeResult?.status || "ok";
    }
  } catch (e: any) {
    bridgeStatus = "error";
    bridgeDetail = e?.message || String(e);
  }

  let kind5Published = false;
  const authorPubkey = (
    (deletionEvent?.pubkey as string) ||
    pubkeyHex ||
    ""
  ).toLowerCase();
  try {
    if (authorPubkey) {
      const aTag = `30617:${authorPubkey}:${name}`;
      const kind5Unsigned: any = {
        kind: KIND_DELETION,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["a", aTag],
          ...(repo.priorEventId ? [["e", repo.priorEventId]] : []),
        ],
        content: `Deleted repository ${name}`,
        pubkey: authorPubkey,
      };
      kind5Unsigned.id = getEventHash(kind5Unsigned);
      const kind5 = await signWithTimeout(
        signer.signEvent(kind5Unsigned),
        signer.source === "remote" ? "Amber kind 5 sign" : "Kind 5 sign"
      );
      if (kind5?.sig) {
        pub.publish(kind5, pub.defaultRelays);
        kind5Published = true;
      }
    }
  } catch (e) {
    console.warn(
      "[soft-delete] NIP-09 kind 5 failed (30617 still published):",
      e
    );
  }

  return {
    deletionEvent,
    bridgeStatus,
    bridgeDetail,
    kind5Published,
  };
}
