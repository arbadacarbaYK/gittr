/**
 * Build and publish Zapstore-compatible NIP-82 events (32267 / 30063 / 3063)
 * pointing asset `url` at forge download URLs — gittr does not host binaries.
 */
import type {
  ForgeReleaseAsset,
  ForgeReleasesOk,
} from "@/lib/repo/forge-releases";
import {
  suggestAppIdFromRepo,
  versionFromTag,
} from "@/lib/repo/forge-releases";

import type { Event as NostrEvent } from "nostr-tools";

import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  MIME_ANDROID_APK,
} from "./nip82-software";
import { publishWithConfirmation } from "./publish-with-confirmation";
import {
  RELAY_ZAPSTORE,
  relaysForSoftwareCatalog,
} from "./software-catalog-relays";

/** Loose unsigned event — nostr-tools Kind enum lags NIP-82 kinds. */
type UnsignedAnnounceEvent = {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  pubkey: string;
};

export type SoftwareAnnounceInput = {
  forge: ForgeReleasesOk;
  appId: string;
  appName: string;
  summary?: string;
  /** Optional SPDX license */
  license?: string;
  /** Optional NIP-34 pointer: 30617:pubkey:repo */
  nip34Address?: string;
  /** Prefer one APK; default = first apk asset */
  selectedApkUrl?: string;
  topics?: string[];
};

export type BuiltSoftwareAnnounce = {
  app: UnsignedAnnounceEvent;
  asset: UnsignedAnnounceEvent;
  release: UnsignedAnnounceEvent;
  version: string;
  appId: string;
  apk: ForgeReleaseAsset;
};

function assertValidAppId(appId: string): string {
  const id = appId.trim();
  if (!id || id.length > 200) {
    throw new Error("Enter a package id (e.g. com.example.app).");
  }
  if (/\s/.test(id)) {
    throw new Error("Package id cannot contain spaces.");
  }
  return id;
}

export function pickAnnounceApk(
  forge: ForgeReleasesOk,
  selectedApkUrl?: string
): ForgeReleaseAsset {
  const apks = forge.release.apkAssets;
  if (apks.length === 0) {
    throw new Error("No APK assets on this release.");
  }
  if (selectedApkUrl) {
    const hit = apks.find((a) => a.downloadUrl === selectedApkUrl);
    if (hit) return hit;
  }
  const arm64 = apks.find((a) => /arm64|aarch64/i.test(a.name));
  const picked = arm64 || apks[0];
  if (!picked) {
    throw new Error("No APK assets on this release.");
  }
  return picked;
}

/**
 * Build unsigned NIP-82 events. Asset requires sha256 (`x`) — fetch with hash=1 first.
 */
export function buildSoftwareAnnounceEvents(
  input: SoftwareAnnounceInput
): BuiltSoftwareAnnounce {
  const appId = assertValidAppId(
    input.appId || suggestAppIdFromRepo(input.forge.repo)
  );
  const version = versionFromTag(input.forge.release.tag);
  const apk = pickAnnounceApk(input.forge, input.selectedApkUrl);
  if (!apk.sha256 || !/^[0-9a-f]{64}$/i.test(apk.sha256)) {
    throw new Error(
      "Missing APK sha256. Reload the release with hashing enabled before publishing."
    );
  }

  const name = (input.appName || input.forge.repo).trim() || input.forge.repo;
  const summary = (input.summary || "").trim().slice(0, 280);
  const now = Math.floor(Date.now() / 1000);

  const appTags: string[][] = [
    ["d", appId],
    ["name", name],
    ["repository", input.forge.repositoryUrl],
    ["f", "android-arm64-v8a"],
    ["t", "android"],
  ];
  if (summary) appTags.push(["summary", summary]);
  if (input.license?.trim()) appTags.push(["license", input.license.trim()]);
  for (const t of input.topics || []) {
    if (t?.trim()) appTags.push(["t", t.trim()]);
  }
  if (input.nip34Address?.trim()) {
    appTags.push(["a", input.nip34Address.trim(), RELAY_ZAPSTORE]);
  }

  const app: UnsignedAnnounceEvent = {
    kind: KIND_SOFTWARE_APPLICATION,
    created_at: now,
    content: input.forge.release.body || summary || name,
    tags: appTags,
    pubkey: "",
  };

  const assetTags: string[][] = [
    ["i", appId],
    ["x", apk.sha256.toLowerCase()],
    ["m", MIME_ANDROID_APK],
    ["url", apk.downloadUrl],
    ["version", version],
    ["f", "android-arm64-v8a"],
  ];
  if (apk.size > 0) assetTags.push(["size", String(apk.size)]);

  const asset: UnsignedAnnounceEvent = {
    kind: KIND_SOFTWARE_ASSET,
    created_at: now,
    content: "",
    tags: assetTags,
    pubkey: "",
  };

  // Release `e` tag filled after asset is signed (needs event id).
  const release: UnsignedAnnounceEvent = {
    kind: KIND_SOFTWARE_RELEASE,
    created_at: now,
    content: input.forge.release.body || "",
    tags: [
      ["d", `${appId}@${version}`],
      ["i", appId],
      ["version", version],
      ["c", "main"],
    ],
    pubkey: "",
  };

  return { app, asset, release, version, appId, apk };
}

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
  confirmedRelays: string[];
  whitelistHint?: string;
};

/**
 * Sign as the logged-in owner and publish app + asset + release to catalog relays.
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

  const signedAsset = await sign(built.asset);
  const releaseUnsigned: UnsignedAnnounceEvent = {
    ...built.release,
    tags: [...built.release.tags, ["e", signedAsset.id, RELAY_ZAPSTORE]],
  };
  const signedRelease = await sign(releaseUnsigned);
  const signedApp = await sign(built.app);

  const confirmed: string[] = [];
  for (const ev of [signedAsset, signedRelease, signedApp]) {
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
    assetEventId: signedAsset.id,
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
    throw new Error("Only the original publisher can delete these app events.");
  }

  const tags: string[][] = ids.map((id) => ["e", id]);
  tags.push(["k", String(KIND_SOFTWARE_APPLICATION)]);
  tags.push(["k", String(KIND_SOFTWARE_RELEASE)]);
  tags.push(["k", String(KIND_SOFTWARE_ASSET)]);

  const unsigned: UnsignedAnnounceEvent = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    content:
      "Delete NIP-82 software announce (app/release/asset); repo unchanged.",
    tags,
    pubkey: signerPubkey,
  };
  const signed = await signer.signEvent(unsigned);
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
