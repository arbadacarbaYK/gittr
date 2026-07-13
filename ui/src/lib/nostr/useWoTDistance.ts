"use client";

import { useEffect, useState } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import {
  KIND_CONTACT_LIST,
  normalizeHexPubkey,
  parseContactListPubkeys,
  resolveWoTDistance,
  type WoTDistanceResult,
} from "@/lib/nostr/wot";

export type WoTDistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "logged_out" }
  | { status: "self" }
  | { status: "ready"; result: WoTDistanceResult | null };

/**
 * Viewer-relative hop distance to `targetPubkey` (hex or npub).
 * Priority: WoT extension → direct follow (kind 3) → oracle API.
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
    const relays = getAllRelays(defaultRelays);
    const unsub = subscribe(
      [{ kinds: [KIND_CONTACT_LIST], authors: [viewerHex], limit: 1 }],
      relays,
      (event) => {
        if (cancelled || event.kind !== KIND_CONTACT_LIST) return;
        setFollows(parseContactListPubkeys(event.tags ?? []));
      },
      8000
    );

    return () => {
      cancelled = true;
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
