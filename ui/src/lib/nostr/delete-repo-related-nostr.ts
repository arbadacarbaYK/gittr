/**
 * On repository delete: find and NIP-09-delete related Nostr Pages (35128)
 * and Zapstore/NIP-82 app announces (32267 / 30063 / 3063) for the same owner+repo.
 */
import { KIND_NSITE_NAMED } from "@/lib/nostr/events";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
} from "@/lib/nostr/nip82-software";
import { deleteSoftwareAnnounceEvents } from "@/lib/nostr/publish-software-announce";
import { publishWithConfirmation } from "@/lib/nostr/publish-with-confirmation";
import { relaysForSoftwareCatalog } from "@/lib/nostr/software-catalog-relays";
import { suggestAppIdFromRepo } from "@/lib/repo/forge-releases";

import type { Event as NostrEvent } from "nostr-tools";

type SubscribeFn = (
  filters: unknown[],
  relays: string[],
  onEvent: (event: unknown, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: unknown
) => () => void;

type PublishFn = (event: NostrEvent, relays: string[]) => void;

type ResolveSigner = () => Promise<{
  // Compatible with ResolvedNostrSigner / NIP-07 adapters
  signEvent: (event: any) => Promise<NostrEvent>;
  getPublicKey: () => Promise<string>;
} | null>;

function readTag(ev: { tags?: string[][] }, key: string): string | undefined {
  const row = (ev.tags || []).find(
    (t) => Array.isArray(t) && t[0] === key && typeof t[1] === "string"
  );
  return row?.[1]?.trim() || undefined;
}

function queryNostrEvents(args: {
  subscribe: SubscribeFn;
  filters: unknown[];
  relays: string[];
  timeoutMs: number;
}): Promise<NostrEvent[]> {
  const { subscribe, filters, relays, timeoutMs } = args;
  return new Promise((resolve) => {
    const byId = new Map<string, NostrEvent>();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve([...byId.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribe(
        filters,
        relays,
        (event) => {
          const ev = event as NostrEvent;
          if (ev?.id) byId.set(ev.id, ev);
        },
        undefined,
        () => {
          clearTimeout(timer);
          // brief grace for late relays
          setTimeout(finish, 400);
        }
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * Discover pages + app/release/asset event ids tied to this owner/repo.
 */
export async function collectRepoRelatedAnnounceIds(args: {
  ownerPubkeyHex: string;
  repoName: string;
  pagesDTag: string;
  subscribe: SubscribeFn;
  relays: string[];
  timeoutMs?: number;
}): Promise<{
  appEventIds: string[];
  pagesEventIds: string[];
  pagesAddress: string;
  appIds: string[];
}> {
  const owner = args.ownerPubkeyHex.toLowerCase();
  const repo = (args.repoName || "").trim();
  const pagesDTag = (args.pagesDTag || "").trim();
  const timeoutMs = args.timeoutMs ?? 10_000;
  const nip34Address = `30617:${owner}:${repo}`;
  const suggestedAppId = suggestAppIdFromRepo(repo);
  const catalogRelays = relaysForSoftwareCatalog(args.relays);
  const pagesRelays = args.relays.length ? args.relays : catalogRelays;

  const pagesAddress = pagesDTag
    ? `${KIND_NSITE_NAMED}:${owner}:${pagesDTag}`
    : "";

  const [pagesEvents, appsByA, appsBySuggestedD] = await Promise.all([
    pagesDTag
      ? queryNostrEvents({
          subscribe: args.subscribe,
          relays: pagesRelays,
          timeoutMs,
          filters: [
            {
              kinds: [KIND_NSITE_NAMED],
              authors: [owner],
              "#d": [pagesDTag],
              limit: 20,
            },
          ],
        })
      : Promise.resolve([] as NostrEvent[]),
    queryNostrEvents({
      subscribe: args.subscribe,
      relays: catalogRelays,
      timeoutMs,
      filters: [
        {
          kinds: [KIND_SOFTWARE_APPLICATION],
          authors: [owner],
          "#a": [nip34Address],
          limit: 20,
        },
      ],
    }),
    queryNostrEvents({
      subscribe: args.subscribe,
      relays: catalogRelays,
      timeoutMs,
      filters: [
        {
          kinds: [KIND_SOFTWARE_APPLICATION],
          authors: [owner],
          "#d": [suggestedAppId],
          limit: 5,
        },
      ],
    }),
  ]);

  const appById = new Map<string, NostrEvent>();
  for (const ev of [...appsByA, ...appsBySuggestedD]) {
    if (ev?.id) appById.set(ev.id, ev);
  }
  const appIds = [
    ...new Set(
      [...appById.values()]
        .map((ev) => readTag(ev, "d"))
        .filter((d): d is string => Boolean(d))
    ),
  ];

  let releaseAndAsset: NostrEvent[] = [];
  if (appIds.length > 0) {
    releaseAndAsset = await queryNostrEvents({
      subscribe: args.subscribe,
      relays: catalogRelays,
      timeoutMs,
      filters: [
        {
          kinds: [KIND_SOFTWARE_RELEASE, KIND_SOFTWARE_ASSET],
          authors: [owner],
          "#i": appIds,
          limit: 100,
        },
      ],
    });
  }

  const appEventIds = [
    ...new Set([
      ...appById.keys(),
      ...releaseAndAsset.map((e) => e.id).filter(Boolean),
    ]),
  ];

  // Prefer newest pages event(s) for this d-tag
  const pagesEventIds = [
    ...new Set(pagesEvents.map((e) => e.id).filter(Boolean)),
  ];

  return { appEventIds, pagesEventIds, pagesAddress, appIds };
}

/** NIP-09 kind 5 for NIP-5A named-site manifests (Nostr Pages). */
export async function deleteNamedSiteManifestEvents(args: {
  eventIds: string[];
  pagesAddress?: string;
  ownerPubkeyHex: string;
  defaultRelays: string[];
  resolveSigner: ResolveSigner;
  publish: PublishFn;
  subscribe: SubscribeFn;
}): Promise<{ deletionEventId: string; confirmedRelays: string[] } | null> {
  const ids = [
    ...new Set(args.eventIds.filter((id) => /^[0-9a-f]{64}$/i.test(id))),
  ];
  if (ids.length === 0 && !args.pagesAddress) return null;

  const signer = await args.resolveSigner();
  if (!signer) {
    throw new Error("No signing method available for Pages deletion.");
  }
  const signerPubkey = (await signer.getPublicKey()).toLowerCase();
  const owner = args.ownerPubkeyHex.toLowerCase();
  if (signerPubkey !== owner) {
    throw new Error("Only the publisher can delete these Pages events.");
  }

  const tags: string[][] = ids.map((id) => ["e", id]);
  if (args.pagesAddress) {
    tags.push(["a", args.pagesAddress]);
  }
  tags.push(["k", String(KIND_NSITE_NAMED)]);

  const unsigned = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    content: "Delete Nostr Pages site manifest; repository deleted.",
    tags,
    pubkey: signerPubkey,
  };
  const signed = await signer.signEvent(unsigned);
  const relays =
    args.defaultRelays.length > 0
      ? args.defaultRelays
      : [...relaysForSoftwareCatalog([])];
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

/**
 * Best-effort: collect + delete app announces and Pages for a repo being deleted.
 * Never throws to the caller — logs and returns a summary.
 */
export async function deleteRepoRelatedAnnounces(args: {
  ownerPubkeyHex: string;
  repoName: string;
  pagesDTag: string;
  defaultRelays: string[];
  subscribe: SubscribeFn;
  publish: PublishFn;
  resolveSigner: ResolveSigner;
}): Promise<{
  appsDeleted: number;
  pagesDeleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let appsDeleted = 0;
  let pagesDeleted = 0;

  try {
    const found = await collectRepoRelatedAnnounceIds({
      ownerPubkeyHex: args.ownerPubkeyHex,
      repoName: args.repoName,
      pagesDTag: args.pagesDTag,
      subscribe: args.subscribe,
      relays: args.defaultRelays,
    });

    if (found.appEventIds.length > 0) {
      try {
        await deleteSoftwareAnnounceEvents({
          eventIds: found.appEventIds,
          ownerPubkeyHex: args.ownerPubkeyHex,
          defaultRelays: args.defaultRelays,
          resolveSigner: args.resolveSigner,
          publish: args.publish,
          subscribe: args.subscribe,
        });
        appsDeleted = found.appEventIds.length;
        console.log(
          `✅ [Repo delete] NIP-09 deleted ${appsDeleted} app/release/asset event(s)`,
          found.appIds
        );
      } catch (e) {
        errors.push(
          e instanceof Error ? e.message : "App announce delete failed"
        );
      }
    }

    if (found.pagesEventIds.length > 0 || found.pagesAddress) {
      try {
        const r = await deleteNamedSiteManifestEvents({
          eventIds: found.pagesEventIds,
          pagesAddress: found.pagesAddress || undefined,
          ownerPubkeyHex: args.ownerPubkeyHex,
          defaultRelays: args.defaultRelays,
          resolveSigner: args.resolveSigner,
          publish: args.publish,
          subscribe: args.subscribe,
        });
        if (r) {
          pagesDeleted = found.pagesEventIds.length || 1;
          console.log(
            `✅ [Repo delete] NIP-09 deleted Nostr Pages manifest`,
            found.pagesAddress,
            r.deletionEventId
          );
        }
      } catch (e) {
        errors.push(
          e instanceof Error ? e.message : "Pages announce delete failed"
        );
      }
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : "Failed to collect related announces"
    );
  }

  return { appsDeleted, pagesDeleted, errors };
}
