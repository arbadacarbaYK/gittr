"use client";

import { useEffect, useState } from "react";

import {
  contactListMentionsHex,
  followersCountFromContactEvents,
  followingCountFromContactEvents,
  normalizeContactPubkey,
} from "@/lib/nostr/contact-list";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import {
  PAUSE_HEAVY_CATALOG_EVENT,
  isModifiedPointerClick,
  shouldPauseHeavyWorkFromPointerTarget,
} from "@/lib/utils/app-navigate";

type SubscribeFn = (
  filters: unknown[],
  relays: string[],
  onEvent: (event: any, afterEose?: boolean, relayURL?: string) => void,
  maxWait?: number,
  onEose?: (...args: any[]) => void
) => (() => void) | void;

export type ProfileFollowCounts = {
  /** Unique pubkeys this profile follows (kind 3). null while loading. */
  following: number | null;
  /**
   * Unique authors whose latest kind 3 still lists this profile.
   * Relay-dependent lower bound. null while loading.
   */
  followers: number | null;
};

type ContactListEvent = {
  pubkey?: string;
  created_at?: number;
  tags?: string[][] | null;
  content?: string | null;
  kind?: number;
};

/** Coalesce follower/following setState so a 400-event kind-3 flood cannot starve chrome nav. */
export const FOLLOW_COUNT_FLUSH_MS = 280;

/**
 * Public social graph sizes for a profile (works logged out).
 * Following = profile’s kind 3 (relays + Primal HTTP cache).
 * Followers = authors of kind 3 with `#p` = profile.
 */
export function useProfileFollowCounts(
  profileHex: string | null | undefined,
  subscribe: SubscribeFn | null | undefined,
  defaultRelays: string[] | null | undefined
): ProfileFollowCounts {
  const [following, setFollowing] = useState<number | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);

  useEffect(() => {
    const hex = normalizeContactPubkey(profileHex || "");
    if (!hex) {
      setFollowing(null);
      setFollowers(null);
      return;
    }

    setFollowing(null);
    setFollowers(null);

    const relays = defaultRelays?.length ? getAllRelays(defaultRelays) : [];
    const followingEvents: ContactListEvent[] = [];
    const followerEvents: ContactListEvent[] = [];

    let cancelled = false;
    let paused = false;
    let followingWsSettled = !subscribe || relays.length === 0;
    let followingHttpSettled = false;
    let followersSettled = !subscribe || relays.length === 0;
    let followingFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let followersFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubFollowing: (() => void) | void;
    let unsubFollowers: (() => void) | void;

    const publishFollowing = () => {
      if (cancelled || paused) return;
      const count = followingCountFromContactEvents(followingEvents);
      if (count > 0) {
        setFollowing(count);
        return;
      }
      if (followingWsSettled && followingHttpSettled) {
        setFollowing(0);
      }
    };
    const publishFollowers = () => {
      if (cancelled || paused) return;
      setFollowers(followersCountFromContactEvents(hex, followerEvents));
    };

    const scheduleFollowing = () => {
      if (cancelled || paused || followingFlushTimer) return;
      followingFlushTimer = setTimeout(() => {
        followingFlushTimer = null;
        publishFollowing();
      }, FOLLOW_COUNT_FLUSH_MS);
    };
    const scheduleFollowers = () => {
      if (cancelled || paused || followersFlushTimer) return;
      followersFlushTimer = setTimeout(() => {
        followersFlushTimer = null;
        publishFollowers();
      }, FOLLOW_COUNT_FLUSH_MS);
    };

    unsubFollowing =
      subscribe && relays.length
        ? subscribe(
            [{ kinds: [3], authors: [hex], limit: 20 }],
            relays,
            (event) => {
              if (cancelled || paused || event?.kind !== 3) return;
              followingEvents.push(event);
              scheduleFollowing();
            },
            8_000,
            () => {
              followingWsSettled = true;
              scheduleFollowing();
            }
          )
        : undefined;

    unsubFollowers =
      subscribe && relays.length
        ? subscribe(
            [{ kinds: [3], "#p": [hex], limit: 400 }],
            relays,
            (event) => {
              if (cancelled || paused || event?.kind !== 3) return;
              if (!contactListMentionsHex(event, hex)) return;
              followerEvents.push(event);
              scheduleFollowers();
            },
            12_000,
            () => {
              followersSettled = true;
              if (followerEvents.length === 0) {
                if (!cancelled && !paused) setFollowers(0);
                return;
              }
              scheduleFollowers();
            }
          )
        : undefined;

    const ac = new AbortController();
    void fetch(`/api/nostr/contact-list?pubkey=${encodeURIComponent(hex)}`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { event?: ContactListEvent | null };
        if (cancelled || paused || !body?.event) return;
        followingEvents.push(body.event);
      })
      .catch(() => {
        /* relays may still have the list */
      })
      .finally(() => {
        followingHttpSettled = true;
        scheduleFollowing();
      });

    const safety = window.setTimeout(() => {
      if (cancelled || paused) return;
      if (!followingWsSettled) followingWsSettled = true;
      if (!followingHttpSettled) followingHttpSettled = true;
      publishFollowing();
      if (!followersSettled) {
        publishFollowers();
        if (followerEvents.length === 0) setFollowers(0);
      }
    }, 15_000);

    const stopWork = () => {
      paused = true;
      cancelled = true;
      ac.abort();
      window.clearTimeout(safety);
      if (followingFlushTimer) {
        clearTimeout(followingFlushTimer);
        followingFlushTimer = null;
      }
      if (followersFlushTimer) {
        clearTimeout(followersFlushTimer);
        followersFlushTimer = null;
      }
      try {
        unsubFollowing?.();
      } catch {
        /* ignore */
      }
      try {
        unsubFollowers?.();
      } catch {
        /* ignore */
      }
    };

    const onPause = () => stopWork();
    const onPointerDown = (e: PointerEvent) => {
      if (isModifiedPointerClick(e)) return;
      if (
        !shouldPauseHeavyWorkFromPointerTarget(
          e.target,
          window.location.pathname
        )
      ) {
        return;
      }
      stopWork();
    };
    window.addEventListener(PAUSE_HEAVY_CATALOG_EVENT, onPause);
    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener(PAUSE_HEAVY_CATALOG_EVENT, onPause);
      document.removeEventListener("pointerdown", onPointerDown, true);
      stopWork();
    };
  }, [profileHex, subscribe, defaultRelays]);

  return { following, followers };
}
