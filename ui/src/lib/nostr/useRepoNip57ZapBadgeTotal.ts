"use client";

import { useEffect, useMemo, useState } from "react";

import { KIND_ZAP } from "@/lib/nostr/events";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import { computeRepoZapBadgeTotal } from "@/lib/payments/zap-tracker";

import type { Event, Filter } from "nostr-tools";

type SubscribeFn = (
  filters: Filter[],
  relays: string[],
  onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: Record<string, unknown>
) => (() => void) | undefined;

/**
 * Live NIP-57 zap receipts (9735) where the repo owner is the zapped pubkey (`#p`),
 * merged with this browser’s gittr_zaps ledger (deduped when a receipt matches a local row).
 */
export function useRepoNip57ZapBadgeTotal(opts: {
  ownerHex: string;
  entity: string;
  repo: string;
  subscribe?: SubscribeFn;
  defaultRelays: string[];
  /** False on server / before owner pubkey is known */
  enabled: boolean;
}): { totalSats: number; networkSats: number; localExtraSats: number } {
  const [nip57Events, setNip57Events] = useState<Event[]>([]);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    const bump = () => setLocalVersion((v) => v + 1);
    if (typeof window === "undefined") return;
    window.addEventListener("gittr:zaps-updated", bump);
    return () => window.removeEventListener("gittr:zaps-updated", bump);
  }, []);

  useEffect(() => {
    if (!opts.enabled || !opts.subscribe || !opts.ownerHex) {
      setNip57Events([]);
      return;
    }
    setNip57Events([]);
    const collected = new Map<string, Event>();
    const filters: Filter[] = [
      { kinds: [KIND_ZAP], "#p": [opts.ownerHex], limit: 800 },
    ];
    const relays = getAllRelays(opts.defaultRelays);
    const unsub = opts.subscribe(
      filters,
      relays,
      (event) => {
        if (event.kind !== KIND_ZAP) return;
        collected.set(event.id, event as Event);
        setNip57Events(Array.from(collected.values()));
      },
      undefined,
      undefined,
      {}
    );
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [opts.enabled, opts.ownerHex, opts.subscribe, opts.defaultRelays]);

  return useMemo(
    () =>
      computeRepoZapBadgeTotal(
        opts.ownerHex,
        opts.entity,
        opts.repo,
        nip57Events
      ),
    [opts.ownerHex, opts.entity, opts.repo, nip57Events, localVersion]
  );
}
