"use client";

import { useEffect, useState } from "react";

import {
  followersCountFromContactEvents,
  followingCountFromContactEvents,
  normalizeContactPubkey,
  parseContactListPubkeys,
} from "@/lib/nostr/contact-list";
import { getAllRelays } from "@/lib/nostr/getAllRelays";

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
    let followingWsSettled = !subscribe || relays.length === 0;
    let followingHttpSettled = false;
    let followersSettled = !subscribe || relays.length === 0;

    const publishFollowing = () => {
      if (cancelled) return;
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
      if (cancelled) return;
      setFollowers(followersCountFromContactEvents(hex, followerEvents));
    };

    const unsubFollowing =
      subscribe && relays.length
        ? subscribe(
            [{ kinds: [3], authors: [hex], limit: 20 }],
            relays,
            (event) => {
              if (cancelled || event?.kind !== 3) return;
              followingEvents.push(event);
              publishFollowing();
            },
            8_000,
            () => {
              followingWsSettled = true;
              publishFollowing();
            }
          )
        : undefined;

    const unsubFollowers =
      subscribe && relays.length
        ? subscribe(
            [{ kinds: [3], "#p": [hex], limit: 400 }],
            relays,
            (event) => {
              if (cancelled || event?.kind !== 3) return;
              if (!parseContactListPubkeys(event).includes(hex)) return;
              followerEvents.push(event);
              publishFollowers();
            },
            12_000,
            () => {
              followersSettled = true;
              publishFollowers();
              if (followerEvents.length === 0) setFollowers(0);
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
        if (cancelled || !body?.event) return;
        followingEvents.push(body.event);
      })
      .catch(() => {
        /* relays may still have the list */
      })
      .finally(() => {
        followingHttpSettled = true;
        publishFollowing();
      });

    const safety = window.setTimeout(() => {
      if (!followingWsSettled) followingWsSettled = true;
      if (!followingHttpSettled) followingHttpSettled = true;
      publishFollowing();
      if (!followersSettled) {
        publishFollowers();
        if (followerEvents.length === 0) setFollowers(0);
      }
    }, 15_000);

    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(safety);
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
  }, [profileHex, subscribe, defaultRelays]);

  return { following, followers };
}
