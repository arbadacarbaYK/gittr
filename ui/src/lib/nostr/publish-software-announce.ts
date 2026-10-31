/**
 * Build and publish Zapstore-compatible NIP-82 events (32267 / 30063 / 3063)
 * pointing asset `url` at forge download URLs — gittr does not host binaries.
 *
 * Zapstore Android still prefers an APK. Extra NIP-82 MIME assets (DMG,
 * AppImage, tar.gz, MSI/EXE, IPA) on the same release tag are also published
 * when sha256 is available — protocol allows multiple `e` tags on kind 30063.
 */
import type { Event as NostrEvent } from "nostr-tools";

import {
  announceSkippedApkNote,
  announceZapstoreProofMessage,
} from "../repo/announce-panel-copy";
import { type ForgeReleaseAsset, isApkAssetName } from "../repo/forge-releases";

import { findAuthorizingApkProof, standardBase64ToBytes } from "./nip-c1-proof";
import { publishWithConfirmation } from "./publish-with-confirmation";
import {
  type SoftwareAnnounceInput,
  type UnsignedAnnounceEvent,
  buildSoftwareAnnounceEvents,
  orphanSoftwareAssetIds,
  pickAnnouncePrimaryAsset,
  pickSiblingNip82Assets,
  validApkCertificateHash,
} from "./software-announce-build";
import {
  RELAY_ZAPSTORE,
  relaysForSoftwareCatalog,
} from "./software-catalog-relays";

export {
  buildSoftwareAnnounceEvents,
  pickAnnounceApk,
  pickAnnouncePrimaryAsset,
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
  /** APKs left off this announce because Zapstore would reject them. */
  notice?: string;
};

const APK_MIME = "application/vnd.android.package-archive";

function relayIsZapstore(url: string): boolean {
  return url.toLowerCase().includes("zapstore");
}

function eventIsApk(event: { tags?: string[][] }): boolean {
  return (event.tags || []).some(
    (tag) => tag[0] === "m" && tag[1] === APK_MIME
  );
}

async function confirmOnRelays(args: {
  publish: PublishSoftwareAnnounceArgs["publish"];
  subscribe: PublishSoftwareAnnounceArgs["subscribe"];
  event: NostrEvent;
  relays: string[];
  requireZapstore: boolean;
  timeoutMs?: number;
}): Promise<string[]> {
  const timeoutMs = args.timeoutMs ?? (args.requireZapstore ? 15_000 : 12_000);
  return new Promise((resolve) => {
    const confirmed: string[] = [];
    let settled = false;
    let unsub: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve(confirmed);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      unsub = args.subscribe(
        [{ ids: [args.event.id], kinds: [args.event.kind] }],
        args.relays,
        (_event, _after, relayURL) => {
          if (relayURL && !confirmed.includes(relayURL))
            confirmed.push(relayURL);
          const done = args.requireZapstore
            ? confirmed.some(relayIsZapstore)
            : confirmed.length > 0;
          if (done) finish();
        }
      );
    } catch {
      finish();
      return;
    }
    try {
      args.publish(args.event, args.relays);
    } catch {
      /* still watch for an echo */
    }
  });
}

async function requireApkOwnershipProof(args: {
  file: ForgeReleaseAsset;
  signerPubkeyHex: string;
  relays: string[];
  subscribe: PublishSoftwareAnnounceArgs["subscribe"];
}): Promise<void> {
  const hash = validApkCertificateHash(args.file.apkCertificateHash);
  const der = standardBase64ToBytes(args.file.apkCertificateDerBase64 || "");
  if (!hash || !der) {
    throw new Error(
      announceZapstoreProofMessage({ reason: "unreadable-cert" })
    );
  }
  const check = await findAuthorizingApkProof({
    subscribe: args.subscribe,
    relays: args.relays,
    signerPubkeyHex: args.signerPubkeyHex,
    certificateDer: der,
    certificateHash: hash,
  });
  if (!check.ok) {
    throw new Error(
      announceZapstoreProofMessage({
        reason: check.reason,
        certificateHash: hash,
      })
    );
  }
}

type ListedEvent = { id?: string; kind?: number; tags?: string[][] };

function collectListedEvents(args: {
  subscribe: PublishSoftwareAnnounceArgs["subscribe"];
  relays: string[];
  pubkey: string;
  appId: string;
}): Promise<ListedEvent[]> {
  return new Promise((resolve) => {
    const byId = new Map<string, ListedEvent>();
    let settled = false;
    let unsub: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve([...byId.values()]);
    };
    const timer = setTimeout(finish, 8_000);
    try {
      unsub = args.subscribe(
        [
          {
            kinds: [3063],
            authors: [args.pubkey],
            "#i": [args.appId],
            limit: 100,
          },
          {
            kinds: [30063],
            authors: [args.pubkey],
            "#i": [args.appId],
            limit: 40,
          },
        ],
        args.relays,
        (event) => {
          const ev = event as ListedEvent;
          if (ev?.id) byId.set(ev.id, ev);
        },
        undefined,
        (relayUrl) => {
          if (relayUrl && relayUrl.includes("zapstore")) {
            setTimeout(finish, 400);
          }
        }
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

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

  const relays = relaysForSoftwareCatalog(args.defaultRelays);
  const selectedUrl = args.input.selectedAssetUrl || args.input.selectedApkUrl;
  const primaryPreview = pickAnnouncePrimaryAsset(
    args.input.forge,
    selectedUrl
  );
  const primaryIsApk = isApkAssetName(
    primaryPreview.name,
    primaryPreview.contentType
  );
  if (primaryIsApk) {
    await requireApkOwnershipProof({
      file: primaryPreview,
      signerPubkeyHex: signerPubkey,
      relays,
      subscribe: args.subscribe,
    });
  }

  const excludeAssetUrls = [...(args.input.excludeAssetUrls || [])];
  const skippedApkNames: string[] = [];
  if (!primaryIsApk) {
    for (const extra of pickSiblingNip82Assets(
      args.input.forge,
      primaryPreview
    )) {
      if (!isApkAssetName(extra.name, extra.contentType)) continue;
      if (excludeAssetUrls.includes(extra.downloadUrl)) continue;
      const hash = validApkCertificateHash(extra.apkCertificateHash);
      const der = standardBase64ToBytes(extra.apkCertificateDerBase64 || "");
      if (!hash || !der) {
        excludeAssetUrls.push(extra.downloadUrl);
        skippedApkNames.push(extra.name);
        continue;
      }
      try {
        await requireApkOwnershipProof({
          file: extra,
          signerPubkeyHex: signerPubkey,
          relays,
          subscribe: args.subscribe,
        });
      } catch {
        excludeAssetUrls.push(extra.downloadUrl);
        skippedApkNames.push(extra.name);
      }
    }
  }

  const built = buildSoftwareAnnounceEvents({
    ...args.input,
    ownerPubkeyHex: args.input.ownerPubkeyHex || args.ownerPubkeyHex,
    excludeAssetUrls,
  });

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

  const zapstoreListing =
    primaryIsApk ||
    eventIsApk(signedPrimary) ||
    signedExtras.some((ev) => eventIsApk(ev));
  const publishedAssets = [signedPrimary, ...signedExtras];

  const withdraw = async (ids: string[]) => {
    try {
      const unique = [
        ...new Set(ids.filter((id) => /^[0-9a-f]{64}$/i.test(id))),
      ];
      if (unique.length === 0) return;
      const signed = await sign({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content:
          "Remove a file event Zapstore did not accept with its release.",
        tags: unique.map((id) => ["e", id]),
        pubkey: "",
      });
      await confirmOnRelays({
        publish: args.publish,
        subscribe: args.subscribe,
        event: signed,
        relays,
        requireZapstore: false,
        timeoutMs: 8_000,
      });
    } catch (error) {
      console.warn("Could not remove an unlinked Zapstore file event", error);
    }
  };

  const confirmed: string[] = [];
  const remember = (urls: string[]) => {
    for (const url of urls) {
      if (!confirmed.includes(url)) confirmed.push(url);
    }
  };
  const landed: string[] = [];
  for (const ev of publishedAssets) {
    const mustLand = zapstoreListing && eventIsApk(ev);
    const urls = await confirmOnRelays({
      publish: args.publish,
      subscribe: args.subscribe,
      event: ev,
      relays,
      requireZapstore: mustLand,
    });
    remember(urls);
    if (mustLand && !urls.some(relayIsZapstore)) {
      await withdraw([...landed, ev.id]);
      throw new Error(
        announceZapstoreProofMessage({ reason: "relay-rejected" })
      );
    }
    landed.push(ev.id);
  }

  const releaseUrls = await confirmOnRelays({
    publish: args.publish,
    subscribe: args.subscribe,
    event: signedRelease,
    relays,
    requireZapstore: zapstoreListing,
  });
  remember(releaseUrls);
  if (zapstoreListing && !releaseUrls.some(relayIsZapstore)) {
    await withdraw([signedRelease.id, ...landed]);
    throw new Error(announceZapstoreProofMessage({ reason: "relay-rejected" }));
  }

  const appUrls = await confirmOnRelays({
    publish: args.publish,
    subscribe: args.subscribe,
    event: signedApp,
    relays,
    requireZapstore: zapstoreListing,
  });
  remember(appUrls);
  if (zapstoreListing && !appUrls.some(relayIsZapstore)) {
    await withdraw([signedApp.id, signedRelease.id, ...landed]);
    throw new Error(announceZapstoreProofMessage({ reason: "relay-rejected" }));
  }

  try {
    const existing = await collectListedEvents({
      subscribe: args.subscribe,
      relays,
      pubkey: signerPubkey,
      appId: built.appId,
    });
    const referenced = new Set<string>(landed);
    for (const event of existing) {
      if (event.kind !== 30063) continue;
      for (const tag of event.tags || []) {
        if (tag[0] === "e" && tag[1]) referenced.add(tag[1]);
      }
    }
    const retire = orphanSoftwareAssetIds({
      version: built.version,
      keepIds: landed,
      assets: existing
        .filter((event) => event.kind === 3063 && event.id)
        .map((event) => ({
          id: event.id as string,
          version: event.tags?.find((tag) => tag[0] === "version")?.[1],
        })),
      referencedIds: referenced,
    });
    if (retire.length > 0) {
      const signed = await sign({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: "Remove a file event that is no longer part of this release.",
        tags: retire.map((id) => ["e", id]),
        pubkey: "",
      });
      await confirmOnRelays({
        publish: args.publish,
        subscribe: args.subscribe,
        event: signed,
        relays,
        requireZapstore: false,
        timeoutMs: 8_000,
      });
    }
  } catch (error) {
    console.warn("Could not clear an older unlinked file event", error);
  }

  const zapstoreOk = confirmed.some(relayIsZapstore);
  return {
    ok: true,
    appId: built.appId,
    version: built.version,
    appEventId: signedApp.id,
    releaseEventId: signedRelease.id,
    assetEventId: signedPrimary.id,
    extraAssetEventIds: signedExtras.map((e) => e.id),
    confirmedRelays: confirmed,
    notice: skippedApkNames.length
      ? announceSkippedApkNote(skippedApkNames)
      : undefined,
    whitelistHint:
      zapstoreListing || zapstoreOk
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
