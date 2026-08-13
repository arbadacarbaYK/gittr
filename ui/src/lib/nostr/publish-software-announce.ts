/**
 * Build and publish Zapstore-compatible NIP-82 events (32267 / 30063 / 3063)
 * pointing asset `url` at forge download URLs — gittr does not host binaries.
 *
 * Zapstore (Android) still requires an APK. Extra NIP-82 MIME assets (DMG,
 * AppImage, MSI/EXE, IPA) on the same release tag are also published when
 * sha256 is available — protocol allows multiple `e` tags on kind 30063.
 */
import type { Event as NostrEvent } from "nostr-tools";

import { publishWithConfirmation } from "./publish-with-confirmation";
import {
  type SoftwareAnnounceInput,
  type UnsignedAnnounceEvent,
  buildSoftwareAnnounceEvents,
} from "./software-announce-build";
import {
  RELAY_ZAPSTORE,
  relaysForSoftwareCatalog,
} from "./software-catalog-relays";

export {
  buildSoftwareAnnounceEvents,
  pickAnnounceApk,
  pickSiblingNip82Assets,
  type BuiltSoftwareAnnounce,
  type SoftwareAnnounceInput,
  type UnsignedAnnounceEvent,
} from "./software-announce-build";

export type PublishSoftwareAnnounceArgs = {
  input: SoftwareAnnounceInput;
  ownerPubkeyHex: string;
  defaultRelays: string[];
  remoteSigner?: unknown;
  resolveSigner: () => Promise<{
    signEvent: (
      event: UnsignedAnnounceEvent | NostrEvent
    ) => Promise<NostrEvent>;
    getPublicKey: () => Promise<string>;
  } | null>;
  publish: (event: NostrEvent, relays: string[]) => void;
  subscribe: (
    filters: unknown[],
    relays: string[],
    onEvent: (event: unknown, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: unknown
  ) => () => void;
};

export type PublishSoftwareAnnounceResult = {
  ok: true;
  appId: string;
  version: string;
  appEventId: string;
  releaseEventId: string;
  assetEventId: string;
  extraAssetEventIds: string[];
  confirmedRelays: string[];
  whitelistHint?: string;
};

/**
 * Sign as the logged-in owner and publish app + asset(s) + release to catalog relays.
 */
export async function publishSoftwareAnnounce(
  args: PublishSoftwareAnnounceArgs
): Promise<PublishSoftwareAnnounceResult> {
  const signer = await args.resolveSigner();
  if (!signer) {
    throw new Error(
      "No signing method available. Use a NIP-07 extension or pair a remote signer."
    );
  }
  const signerPubkey = (await signer.getPublicKey()).toLowerCase();
  const owner = args.ownerPubkeyHex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(owner)) {
    throw new Error("Repository owner pubkey is missing.");
  }
  if (signerPubkey !== owner) {
    throw new Error(
      "Only the repository owner can announce this app (signer must match owner)."
    );
  }

  const built = buildSoftwareAnnounceEvents(args.input);
  const relays = relaysForSoftwareCatalog(args.defaultRelays);

  const sign = async (unsigned: UnsignedAnnounceEvent): Promise<NostrEvent> => {
    const withPubkey = { ...unsigned, pubkey: signerPubkey };
    return signer.signEvent(withPubkey);
  };

  const signedPrimary = await sign(built.asset);
  const signedExtras: NostrEvent[] = [];
  for (const extra of built.extraAssets) {
    signedExtras.push(await sign(extra));
  }

  const releaseTags: string[][] = [
    ...built.release.tags,
    ["e", signedPrimary.id, RELAY_ZAPSTORE],
    ...signedExtras.map((ev) => ["e", ev.id, RELAY_ZAPSTORE]),
  ];
  const signedRelease = await sign({
    ...built.release,
    tags: releaseTags,
  });
  const signedApp = await sign(built.app);

  const confirmed: string[] = [];
  for (const ev of [signedPrimary, ...signedExtras, signedRelease, signedApp]) {
    const result = await publishWithConfirmation(
      args.publish as any,
      args.subscribe as any,
      ev,
      relays,
      12_000
    );
    for (const r of result.confirmedRelays) {
      if (!confirmed.includes(r)) confirmed.push(r);
    }
  }

  const zapstoreOk = confirmed.some((r) => r.includes("zapstore"));
  return {
    ok: true,
    appId: built.appId,
    version: built.version,
    appEventId: signedApp.id,
    releaseEventId: signedRelease.id,
    assetEventId: signedPrimary.id,
    extraAssetEventIds: signedExtras.map((e) => e.id),
    confirmedRelays: confirmed,
    whitelistHint: zapstoreOk
      ? undefined
      : "If Zapstore’s relay rejected the events, commit a zapstore.yaml in the forge repo root with repository + your pubkey (npub), then publish again — Zapstore’s free auto-whitelist path. See https://zapstore.dev/docs/publish",
  };
}

/**
 * NIP-09 deletion for app/release/asset events only — does not touch NIP-34 repo events.
 * Same author must sign. Clients that honor kind 5 (gittr /apps does) hide the app.
 */
export async function deleteSoftwareAnnounceEvents(args: {
  eventIds: string[];
  ownerPubkeyHex: string;
  defaultRelays: string[];
  resolveSigner: () => Promise<{
    signEvent: (
      event: UnsignedAnnounceEvent | NostrEvent
    ) => Promise<NostrEvent>;
    getPublicKey: () => Promise<string>;
  } | null>;
  publish: (event: NostrEvent, relays: string[]) => void;
  subscribe: PublishSoftwareAnnounceArgs["subscribe"];
}): Promise<{ deletionEventId: string; confirmedRelays: string[] }> {
  const ids = [
    ...new Set(args.eventIds.filter((id) => /^[0-9a-f]{64}$/i.test(id))),
  ];
  if (ids.length === 0) {
    throw new Error("No event ids to delete.");
  }
  const signer = await args.resolveSigner();
  if (!signer) {
    throw new Error(
      "No signing method available. Use a NIP-07 extension or pair a remote signer."
    );
  }
  const signerPubkey = (await signer.getPublicKey()).toLowerCase();
  const owner = args.ownerPubkeyHex.toLowerCase();
  if (signerPubkey !== owner) {
    throw new Error("Only the repository owner can delete this announce.");
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedAnnounceEvent = {
    kind: 5,
    created_at: now,
    content:
      "Delete NIP-82 software announce (app/release/asset); repo unchanged.",
    tags: ids.map((id) => ["e", id]),
    pubkey: "",
  };
  const signed = await signer.signEvent({ ...unsigned, pubkey: signerPubkey });
  const relays = relaysForSoftwareCatalog(args.defaultRelays);
  const result = await publishWithConfirmation(
    args.publish as any,
    args.subscribe as any,
    signed,
    relays,
    12_000
  );
  return {
    deletionEventId: signed.id,
    confirmedRelays: result.confirmedRelays,
  };
}
