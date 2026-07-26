"use client";

import { useEffect, useState } from "react";

import {
  CONTACT_LIST_CHANGED_EVENT,
  type ContactListChangedDetail,
  loadKnownContactList,
  mergeContactLists,
  parseContactListPubkeys as parseContactListEvent,
} from "@/lib/nostr/contact-list";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import {
  KIND_CONTACT_LIST,
  clearWoTDistanceCache,
  normalizeHexPubkey,
  resolveWoTDistance,
} from "@/lib/nostr/wot";

export type WoTDistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "logged_out" }
  | { status: "self" }
  | {
      status: "ready";
      result: Awaited<ReturnType<typeof resolveWoTDistance>>;
    };

const FOLLOWS_WAIT_MS = 8500;

/**
 * Viewer-relative hop distance to `targetPubkey` (hex or npub).
 * Priority: direct follow (kind 3 + local backup) → WoT extension → oracle API.
 */
export function useWoTDistance(
  targetPubkey: string | null | undefined
): WoTDistanceState {
  const { pubkey: viewerPubkey, subscribe, defaultRelays } = useNostrContext();
  const [follows, setFollows] = useState<Set<string> | null>(null);
  const [state, setState] = useState<WoTDistanceState>({ status: "idle" });

  const viewerHex = normalizeHexPubkey(viewerPubkey);
  const targetHex = normalizeHexPubkey(targetPubkey);

  useEffect(() => {
    if (!viewerHex) {
      setFollows(null);
      return;
    }
    if (!subscribe) return;

    let cancelled = false;
    // Same backup the Follow button writes — so a fresh follow shows
    // "In your network" even if relays return a stale limit:1 kind 3.
    // If backup is empty, keep `follows` null until a relay event or timeout
    // so we don't flash "Outside" before kind 3 arrives.
    const known = loadKnownContactList(viewerHex);
    if (known.length > 0) {
      setFollows(new Set(known));
    } else {
      setFollows(null);
    }

    const applyUnion = (pubkeys: string[]) => {
      if (cancelled || pubkeys.length === 0) return;
      setFollows((prev) => {
        const merged = mergeContactLists(
          prev ? Array.from(prev) : [],
          pubkeys
        );
        return new Set(merged);
      });
    };

    const onLocalChange = (ev: Event) => {
      const detail = (ev as CustomEvent<ContactListChangedDetail>).detail;
      if (!detail?.ownerPubkey || detail.ownerPubkey !== viewerHex) return;
      clearWoTDistanceCache(viewerHex);
      setFollows(new Set(detail.pubkeys));
    };
    window.addEventListener(CONTACT_LIST_CHANGED_EVENT, onLocalChange);

    const relays = getAllRelays(defaultRelays);
    const unsub = subscribe(
      [
        {
          kinds: [KIND_CONTACT_LIST],
          authors: [viewerHex],
          limit: 20,
          noCache: true,
        },
      ],
      relays,
      (event) => {
        if (cancelled || event.kind !== KIND_CONTACT_LIST) return;
        applyUnion(parseContactListEvent(event));
      },
      8000
    );

    // If kind-3 never arrives, stop waiting so oracle/Outside can resolve.
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setFollows((prev) => prev ?? new Set(loadKnownContactList(viewerHex)));
      }
    }, FOLLOWS_WAIT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener(CONTACT_LIST_CHANGED_EVENT, onLocalChange);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [viewerHex, subscribe, defaultRelays]);

  useEffect(() => {
    if (!targetHex) {
      setState({ status: "idle" });
      return;
    }
    if (!viewerHex) {
      setState({ status: "logged_out" });
      return;
    }
    if (viewerHex === targetHex) {
      setState({ status: "self" });
      return;
    }

    // Wait for follow list before declaring Outside — otherwise a slow kind-3
    // looks like "not following" and the badge flips wrongly on repo pages.
    if (follows === null) {
      setState({ status: "loading" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void resolveWoTDistance({
      viewerHex,
      targetHex,
      follows,
    }).then((result) => {
      if (cancelled) return;
      setState({ status: "ready", result });
    });

    return () => {
      cancelled = true;
    };
  }, [viewerHex, targetHex, follows]);

  return state;
}
