"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SoftwareAppDirectoryCard,
  SoftwareAppSourceButtons,
} from "@/components/apps/SoftwareAppDirectoryCard";
import { buttonVariants } from "@/components/ui/button";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { assetIdsAndRelayHintsFromRelease } from "@/lib/nostr/nip82-repo-releases";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareApp,
  type ParsedSoftwareAsset,
  type ParsedSoftwareRelease,
  appDedupKey,
  collectNip09SoftwareDeletions,
  dedupeSoftwareApps,
  mergeSoftwareApps,
  mimeToKindLabel,
  omitDeletedSoftwareApps,
  parseSoftwareAsset,
  parseSoftwareRelease,
  pickAndroidApkAsset,
  pickLatestMainRelease,
  platformHintToLabel,
  slimSoftwareAppForCatalog,
  sortSoftwareAppsByCreatedAt,
} from "@/lib/nostr/nip82-software";
import { relaysForSoftwareCatalog } from "@/lib/nostr/software-catalog-relays";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { isOfficialGittrAndroidListing } from "@/lib/repo/gittr-android-app";
import {
  type GittrAndroidLatestOk,
  resolveOfficialGittrAppsApk,
} from "@/lib/repo/gittr-android-latest";
import {
  REPO_LIST_PAGE_SIZE,
  clampVisibleCount,
} from "@/lib/ui/list-pagination";
import { cn } from "@/lib/utils";
import {
  PAUSE_HEAVY_CATALOG_EVENT,
  appNavigate,
  isModifiedPointerClick,
  shouldPauseHeavyWorkFromPointerTarget,
} from "@/lib/utils/app-navigate";

import { ChevronDown, Download, Loader2, Package, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nip19 } from "nostr-tools";

function CardSkeleton() {
  return (
    <li className="animate-pulse rounded-xl border border-[#383B42]/80 bg-[#0E1116]/60 p-4">
      <div className="flex gap-4">
        <div className="h-16 w-16 shrink-0 rounded-xl bg-gray-800" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-3/4 max-w-[14rem] rounded bg-gray-800" />
          <div className="h-4 w-1/2 rounded bg-gray-800/80" />
          <div className="h-9 w-32 rounded-md bg-gray-800" />
        </div>
      </div>
    </li>
  );
}

function shortNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex).slice(0, 16) + "…";
  } catch {
    return hex.slice(0, 12) + "…";
  }
}

function upsertReleaseInMap(
  map: Map<string, ParsedSoftwareRelease[]>,
  mapKey: string,
  r: ParsedSoftwareRelease
): void {
  const list = map.get(mapKey) ?? [];
  const idx = list.findIndex((x) => x.d === r.d);
  let nextList: ParsedSoftwareRelease[];
  if (idx === -1) {
    nextList = [...list, r];
  } else {
    const prev = list[idx]!;
    nextList = [...list];
    if (r.createdAt >= prev.createdAt) {
      nextList[idx] = r;
    }
  }
  map.set(mapKey, nextList);
}

/** Coarse OS / runtime filters from NIP-82 `f` tags on the app event only. */
function collectPlatformFilterOptions(appsList: ParsedSoftwareApp[]): string[] {
  const s = new Set<string>();
  for (const a of appsList) {
    for (const f of a.platformHints) {
      const lbl = platformHintToLabel(f);
      if (lbl) s.add(lbl);
    }
  }
  return Array.from(s).sort((x, y) =>
    x.localeCompare(y, undefined, { sensitivity: "base" })
  );
}

/**
 * Publisher `t` tags — can be hundreds. Exclude strings that duplicate a platform pill (case-insensitive).
 */
function collectTopicTagOptions(appsList: ParsedSoftwareApp[]): string[] {
  const platformOpts = collectPlatformFilterOptions(appsList);
  const platformLc = new Set(platformOpts.map((p) => p.toLowerCase()));
  const s = new Set<string>();
  for (const a of appsList) {
    for (const raw of a.topics) {
      const t = raw.trim();
      if (!t) continue;
      if (platformLc.has(t.toLowerCase())) continue;
      s.add(t);
    }
  }
  return Array.from(s).sort((x, y) =>
    x.localeCompare(y, undefined, { sensitivity: "base" })
  );
}

function getAssetEventsForApp(
  app: ParsedSoftwareApp,
  releasesByApp: Map<string, ParsedSoftwareRelease[]>,
  releasesByAppId: Map<string, ParsedSoftwareRelease[]>,
  assetsById: Map<string, ParsedSoftwareAsset>
): ParsedSoftwareAsset[] {
  const strictKey = appDedupKey(app.pubkey, app.appId);
  const strict = releasesByApp.get(strictKey);
  const list =
    strict && strict.length > 0 ? strict : releasesByAppId.get(app.appId) ?? [];
  const latest = pickLatestMainRelease(list);
  const evs: ParsedSoftwareAsset[] = [];
  if (latest) {
    for (const id of latest.assetEventIds) {
      const asset = assetsById.get(id);
      if (asset) evs.push(asset);
    }
  }
  return evs;
}

function cardLabelsForApp(
  app: ParsedSoftwareApp,
  assetEvents: ParsedSoftwareAsset[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (x: string) => {
    const t = x.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const t of app.topics) push(t);
  for (const f of app.platformHints) {
    const lbl = platformHintToLabel(f);
    if (lbl) push(lbl);
  }
  for (const asset of assetEvents) {
    const lbl = mimeToKindLabel(asset.mime);
    if (lbl) push(lbl);
  }
  return out;
}

export function AppsDirectoryClient() {
  const { subscribe, defaultRelays, pubkey } = useNostrContext();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<ParsedSoftwareApp[]>([]);
  const [releasesByApp, setReleasesByApp] = useState<
    Map<string, ParsedSoftwareRelease[]>
  >(() => new Map());
  /** When release signer pubkey ≠ app pubkey, match by NIP-82 `i` (app id) only. */
  const [releasesByAppId, setReleasesByAppId] = useState<
    Map<string, ParsedSoftwareRelease[]>
  >(() => new Map());
  const [assetsById, setAssetsById] = useState<
    Map<string, ParsedSoftwareAsset>
  >(() => new Map());
  /** After asset-id subscribe window, stop spinning on unresolved e-tags. */
  const [assetFetchSettled, setAssetFetchSettled] = useState(false);
  const [gittrGithubLatest, setGittrGithubLatest] =
    useState<GittrAndroidLatestOk | null>(null);

  const rawAppEventsRef = useRef<NostrEventLike[]>([]);
  /** NIP-09 kind 5 — event id → deletion author (repo NIP-34 unchanged). */
  const deletedEventAuthorsRef = useRef<Map<string, string>>(new Map());
  const deletedAddressKeysRef = useRef<Set<string>>(new Set());
  const releasesRef = useRef<Map<string, ParsedSoftwareRelease[]>>(new Map());
  const releasesByAppIdRef = useRef<Map<string, ParsedSoftwareRelease[]>>(
    new Map()
  );
  const assetsRef = useRef<Set<string>>(new Set());
  const assetSubUnsubsRef = useRef<Array<() => void>>([]);
  /** Stop catalog setState on leave — do not set this in subscribe cleanup
   *  (a relaysKey rerun would freeze the page while still on /apps). */
  const leavingRef = useRef(false);

  const relays = useMemo(
    () => relaysForSoftwareCatalog(defaultRelays),
    [defaultRelays]
  );
  const relaysKey = useMemo(() => relays.join("|"), [relays]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/repo/gittr-android-latest", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GittrAndroidLatestOk | { ok?: false } | null) => {
        if (cancelled || !data || data.ok !== true) return;
        setGittrGithubLatest(data);
      })
      .catch(() => {
        /* keep NIP-82 catalog button */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAppsFromRef = useCallback(() => {
    if (leavingRef.current) return;
    const map = dedupeSoftwareApps(rawAppEventsRef.current);
    setApps(
      omitDeletedSoftwareApps(
        sortSoftwareAppsByCreatedAt(Array.from(map.values())),
        deletedEventAuthorsRef.current,
        deletedAddressKeysRef.current
      )
    );
  }, []);

  const pruneDeletedReleases = useCallback(() => {
    if (leavingRef.current) return;
    const authors = deletedEventAuthorsRef.current;
    const addrs = deletedAddressKeysRef.current;
    const pruneMap = (src: Map<string, ParsedSoftwareRelease[]>) => {
      const next = new Map<string, ParsedSoftwareRelease[]>();
      for (const [k, list] of src) {
        const filtered = list.filter((r) => {
          const id = (r.raw?.id || "").toLowerCase();
          const owner = (r.pubkey || "").toLowerCase();
          if (id && authors.get(id) === owner) return false;
          if (addrs.has(`30063:${owner}:${r.d}`.toLowerCase())) return false;
          return true;
        });
        if (filtered.length > 0) next.set(k, filtered);
      }
      return next;
    };
    releasesRef.current = pruneMap(releasesRef.current);
    releasesByAppIdRef.current = pruneMap(releasesByAppIdRef.current);
    setReleasesByApp(new Map(releasesRef.current));
    setReleasesByAppId(new Map(releasesByAppIdRef.current));
    setAssetsById((prev) => {
      const next = new Map(prev);
      for (const [id, author] of authors) {
        const asset = next.get(id);
        if (asset && asset.pubkey?.toLowerCase() === author) next.delete(id);
      }
      return next;
    });
  }, []);

  const catalogFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const catalogNeedsAppsRef = useRef(false);
  const catalogNeedsReleasesRef = useRef(false);

  const flushCatalogUi = useCallback(() => {
    catalogFlushTimerRef.current = null;
    if (leavingRef.current) return;
    if (catalogNeedsAppsRef.current) {
      catalogNeedsAppsRef.current = false;
      refreshAppsFromRef();
    }
    if (catalogNeedsReleasesRef.current) {
      catalogNeedsReleasesRef.current = false;
      setReleasesByApp(new Map(releasesRef.current));
      setReleasesByAppId(new Map(releasesByAppIdRef.current));
    }
  }, [refreshAppsFromRef]);

  const scheduleCatalogFlush = useCallback(() => {
    if (leavingRef.current) return;
    if (catalogFlushTimerRef.current != null) return;
    catalogFlushTimerRef.current = setTimeout(flushCatalogUi, 280);
  }, [flushCatalogUi]);

  const pauseCatalogForLeave = useCallback(() => {
    leavingRef.current = true;
    if (catalogFlushTimerRef.current != null) {
      clearTimeout(catalogFlushTimerRef.current);
      catalogFlushTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onPause = () => pauseCatalogForLeave();
    const onPointerDown = (e: PointerEvent) => {
      if (isModifiedPointerClick(e)) {
        return;
      }
      if (
        !shouldPauseHeavyWorkFromPointerTarget(e.target, pathname || "/apps")
      ) {
        return;
      }
      pauseCatalogForLeave();
    };
    window.addEventListener(PAUSE_HEAVY_CATALOG_EVENT, onPause);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener(PAUSE_HEAVY_CATALOG_EVENT, onPause);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pauseCatalogForLeave, pathname]);

  const mergeReleaseEvent = useCallback(
    (event: NostrEventLike) => {
      if (isPublisherBlocklisted(event.pubkey)) return;
      const eid = (event.id || "").toLowerCase();
      const author = eid ? deletedEventAuthorsRef.current.get(eid) : undefined;
      if (author && author === (event.pubkey || "").toLowerCase()) return;
      const r = parseSoftwareRelease(event);
      if (!r) return;
      const key = appDedupKey(r.pubkey, r.appId);
      upsertReleaseInMap(releasesRef.current, key, r);
      upsertReleaseInMap(releasesByAppIdRef.current, r.appId, r);
      catalogNeedsReleasesRef.current = true;
      scheduleCatalogFlush();
    },
    [scheduleCatalogFlush]
  );

  const ingestDeletionEvent = useCallback(
    (event: NostrEventLike) => {
      if (event.kind !== 5) return;
      const author = (event.pubkey || "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(author)) return;
      const hits = collectNip09SoftwareDeletions(event);
      let changed = false;
      for (const id of hits.eventIds) {
        if (deletedEventAuthorsRef.current.get(id) !== author) {
          deletedEventAuthorsRef.current.set(id, author);
          changed = true;
        }
      }
      for (const a of hits.addressKeys) {
        if (!deletedAddressKeysRef.current.has(a)) {
          deletedAddressKeysRef.current.add(a);
          changed = true;
        }
      }
      if (changed) {
        refreshAppsFromRef();
        pruneDeletedReleases();
      }
    },
    [refreshAppsFromRef, pruneDeletedReleases]
  );

  const applyServerCatalog = useCallback(
    (data: {
      apps?: ParsedSoftwareApp[];
      releasesByApp?: Record<string, ParsedSoftwareRelease[]>;
      releasesByAppId?: Record<string, ParsedSoftwareRelease[]>;
      deletedEventAuthors?: Record<string, string>;
      deletedAddressKeys?: string[];
    }) => {
      if (leavingRef.current) return;
      if (data.deletedEventAuthors) {
        for (const [id, pk] of Object.entries(data.deletedEventAuthors)) {
          if (!/^[0-9a-f]{64}$/i.test(id) || !/^[0-9a-f]{64}$/i.test(pk)) {
            continue;
          }
          deletedEventAuthorsRef.current.set(
            id.toLowerCase(),
            pk.toLowerCase()
          );
        }
      }
      if (data.deletedAddressKeys) {
        for (const a of data.deletedAddressKeys) {
          if (a) deletedAddressKeysRef.current.add(String(a).toLowerCase());
        }
      }
      if (data.apps?.length) {
        setApps((prev) =>
          omitDeletedSoftwareApps(
            mergeSoftwareApps(prev, data.apps),
            deletedEventAuthorsRef.current,
            deletedAddressKeysRef.current
          )
        );
        for (const a of data.apps) {
          rawAppEventsRef.current.push(slimSoftwareAppForCatalog(a).raw);
        }
        const kept = dedupeSoftwareApps(rawAppEventsRef.current);
        rawAppEventsRef.current = Array.from(kept.values()).map(
          (a) => slimSoftwareAppForCatalog(a).raw
        );
      } else if (
        deletedEventAuthorsRef.current.size > 0 ||
        deletedAddressKeysRef.current.size > 0
      ) {
        refreshAppsFromRef();
      }
      if (data.releasesByApp) {
        for (const [k, list] of Object.entries(data.releasesByApp)) {
          for (const r of list) {
            upsertReleaseInMap(releasesRef.current, k, r);
          }
        }
        setReleasesByApp(new Map(releasesRef.current));
      }
      if (data.releasesByAppId) {
        for (const [k, list] of Object.entries(data.releasesByAppId)) {
          for (const r of list) {
            upsertReleaseInMap(releasesByAppIdRef.current, k, r);
          }
        }
        setReleasesByAppId(new Map(releasesByAppIdRef.current));
      }
      pruneDeletedReleases();
    },
    [pruneDeletedReleases, refreshAppsFromRef]
  );

  const [catalogBackfilling, setCatalogBackfilling] = useState(false);

  const fetchCatalogFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/nostr/software-catalog", {
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        apps?: ParsedSoftwareApp[];
        releasesByApp?: Record<string, ParsedSoftwareRelease[]>;
        releasesByAppId?: Record<string, ParsedSoftwareRelease[]>;
        deletedEventAuthors?: Record<string, string>;
        deletedAddressKeys?: string[];
        backfilling?: boolean;
      };
      applyServerCatalog(data);
      setCatalogBackfilling(!!data.backfilling);
      return (data.apps?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }, [applyServerCatalog]);

  const [ghStats, setGhStats] = useState<
    Record<string, { stars: number; forks: number }>
  >({});

  const requestAssetBatch = useCallback(
    (ids: string[], extraRelays: string[] = []) => {
      if (!subscribe || ids.length === 0) return;
      const missing = ids.filter((id) => !assetsRef.current.has(id));
      if (missing.length === 0) return;
      const relayList = Array.from(
        new Set([...relays, ...extraRelays].filter(Boolean))
      );
      const chunkSize = 350;
      for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize);
        const unsub = subscribe(
          [{ kinds: [KIND_SOFTWARE_ASSET], ids: chunk }],
          relayList,
          (event: NostrEventLike) => {
            if (leavingRef.current) return;
            const a = parseSoftwareAsset(event);
            if (!a) return;
            assetsRef.current.add(a.id);
            setAssetsById((prev) => {
              if (leavingRef.current || prev.has(a.id)) return prev;
              const next = new Map(prev);
              next.set(a.id, a);
              return next;
            });
          },
          12000
        );
        assetSubUnsubsRef.current.push(unsub);
      }
    },
    [subscribe, relays]
  );

  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (leavingRef.current) return;
    rawAppEventsRef.current = [];
    deletedEventAuthorsRef.current = new Map();
    deletedAddressKeysRef.current = new Set();
    releasesRef.current = new Map();
    releasesByAppIdRef.current = new Map();
    assetsRef.current = new Set();
    setApps([]);
    setReleasesByApp(new Map());
    setReleasesByAppId(new Map());
    setAssetsById(new Map());
    setAssetFetchSettled(false);
    setLoading(true);
    setLoadError(null);

    let cancelled = false;
    let cleaned = false;
    let liveUnsub = () => {};

    const finishLoading = () => {
      if (!cancelled && !leavingRef.current) setLoading(false);
    };

    const stopTimer = setTimeout(() => {
      finishLoading();
    }, 18000);

    const startLiveDeletionWatch = () => {
      if (!subscribe || cancelled || leavingRef.current || cleaned) return;
      const unsub = subscribe(
        [{ kinds: [5], limit: 800 }],
        relays,
        (event: NostrEventLike) => {
          if (cancelled || leavingRef.current) return;
          ingestDeletionEvent(event);
        },
        400
      );
      const prev = liveUnsub;
      liveUnsub = () => {
        prev();
        unsub();
      };
    };

    const startLiveCatalogFallback = () => {
      if (!subscribe || cancelled || leavingRef.current || cleaned) return;
      const unsub = subscribe(
        [
          { kinds: [KIND_SOFTWARE_APPLICATION], limit: 4000 },
          { kinds: [KIND_SOFTWARE_RELEASE], limit: 12000 },
          { kinds: [5], limit: 2000 },
        ],
        relays,
        (event: NostrEventLike) => {
          if (cancelled || leavingRef.current) return;
          if (event.kind === 5) {
            ingestDeletionEvent(event);
            return;
          }
          if (event.kind === KIND_SOFTWARE_APPLICATION) {
            const eid = (event.id || "").toLowerCase();
            const delAuthor = eid
              ? deletedEventAuthorsRef.current.get(eid)
              : undefined;
            if (delAuthor && delAuthor === (event.pubkey || "").toLowerCase()) {
              finishLoading();
              return;
            }
            if (!isPublisherBlocklisted(event.pubkey)) {
              rawAppEventsRef.current.push(event);
              catalogNeedsAppsRef.current = true;
              scheduleCatalogFlush();
            }
            finishLoading();
            return;
          }
          if (event.kind === KIND_SOFTWARE_RELEASE) {
            mergeReleaseEvent(event);
          }
        },
        // Deliver ASAP — 16s batching made the client fallback look "broken"
        // for a long empty stretch after the server path returned [].
        400
      );
      if (cleaned || cancelled || leavingRef.current) {
        unsub();
        return;
      }
      const prev = liveUnsub;
      liveUnsub = () => {
        prev();
        unsub();
      };
    };

    void (async () => {
      const ok = await fetchCatalogFromServer();
      if (cancelled || leavingRef.current) return;
      startLiveDeletionWatch();
      if (ok) {
        // Snapshot like /pages — a live 4000/12000 scrape starves chrome
        // and owner-name clicks even when search shows one card.
        finishLoading();
        return;
      }
      startLiveCatalogFallback();
    })();

    return () => {
      cancelled = true;
      cleaned = true;
      clearTimeout(stopTimer);
      if (catalogFlushTimerRef.current != null) {
        clearTimeout(catalogFlushTimerRef.current);
        catalogFlushTimerRef.current = null;
      }
      liveUnsub();
      assetSubUnsubsRef.current.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      assetSubUnsubsRef.current = [];
    };
  }, [
    subscribe,
    relaysKey,
    reloadNonce,
    fetchCatalogFromServer,
    refreshAppsFromRef,
    pruneDeletedReleases,
    mergeReleaseEvent,
    ingestDeletionEvent,
    scheduleCatalogFlush,
  ]);

  useEffect(() => {
    if (leavingRef.current) return;
    if (loading || apps.length > 0) return;
    void fetchCatalogFromServer().then((ok) => {
      if (leavingRef.current) return;
      if (!ok) {
        setLoadError(
          "Could not load apps from Nostr relays. Try again — no login or extension is required."
        );
      }
    });
  }, [loading, apps.length, fetchCatalogFromServer]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (leavingRef.current) return;
      void fetchCatalogFromServer();
    }, 150_000);
    return () => window.clearInterval(id);
  }, [fetchCatalogFromServer]);

  useEffect(() => {
    if (!catalogBackfilling) return;
    const id = window.setInterval(() => {
      if (leavingRef.current) return;
      void fetchCatalogFromServer();
    }, 8000);
    return () => window.clearInterval(id);
  }, [catalogBackfilling, fetchCatalogFromServer]);

  const releasesForApp = useCallback(
    (app: ParsedSoftwareApp): ParsedSoftwareRelease[] => {
      const strictKey = appDedupKey(app.pubkey, app.appId);
      const strict = releasesByApp.get(strictKey);
      if (strict && strict.length > 0) return strict;
      return releasesByAppId.get(app.appId) ?? [];
    },
    [releasesByApp, releasesByAppId]
  );

  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [topicsFilterOpen, setTopicsFilterOpen] = useState(false);
  const [topicChipQuery, setTopicChipQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(REPO_LIST_PAGE_SIZE);

  useEffect(() => {
    const fromUrl = searchParams?.get("q")?.trim();
    if (fromUrl) setQuery(fromUrl);
  }, [searchParams]);

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = apps;
    if (q) {
      list = list.filter((a) => {
        const hay = [
          a.name,
          a.summary,
          a.appId,
          a.repository,
          a.gittrRepoPath,
          a.webUrl,
          a.content,
          a.license,
          shortNpub(a.pubkey),
          ...a.topics,
          ...a.platformHints.map((h) => platformHintToLabel(h) ?? h),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (activeTag) {
      list = list.filter((a) =>
        cardLabelsForApp(
          a,
          getAssetEventsForApp(a, releasesByApp, releasesByAppId, assetsById)
        ).includes(activeTag)
      );
    }
    return list;
    // Release/asset maps only change card labels when a topic/platform pill
    // is active — skip that walk on search-only updates.
  }, [
    apps,
    query,
    activeTag,
    activeTag ? releasesByApp : null,
    activeTag ? releasesByAppId : null,
    activeTag ? assetsById : null,
  ]);

  useEffect(() => {
    setVisibleCount(REPO_LIST_PAGE_SIZE);
  }, [query, activeTag]);

  const shownCount = clampVisibleCount(visibleCount, filteredApps.length);
  const visibleApps = useMemo(
    () => filteredApps.slice(0, shownCount),
    [filteredApps, shownCount]
  );

  const githubRepoKeys = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const a of visibleApps) {
      if (!a.repository) continue;
      const spec = parseGitHubRepoSpec(a.repository);
      if (!spec) continue;
      const k = `${spec.owner}/${spec.repo}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(k);
    }
    return ordered.sort();
  }, [visibleApps]);

  useEffect(() => {
    if (leavingRef.current) return;
    if (githubRepoKeys.length === 0) {
      setGhStats({});
      return;
    }
    let cancelled = false;
    const specs = githubRepoKeys.slice(0, 25).map((k) => {
      const [owner, repo] = k.split("/");
      return { owner, repo };
    });
    fetch("/api/github/public-repo-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: specs }),
    })
      .then((r) => r.json())
      .then(
        (data: {
          stats?: Record<string, { stars: number; forks: number }>;
        }) => {
          if (!cancelled && !leavingRef.current && data?.stats) {
            setGhStats(data.stats);
          }
        }
      )
      .catch(() => {
        if (!cancelled && !leavingRef.current) setGhStats({});
      });
    return () => {
      cancelled = true;
    };
  }, [githubRepoKeys.join(",")]);

  const profilePubkeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of visibleApps) {
      if (/^[0-9a-f]{64}$/i.test(a.pubkey)) {
        s.add(a.pubkey.toLowerCase());
      }
      for (const p of a.attributedPubkeys) {
        s.add(p);
      }
    }
    return Array.from(s);
  }, [visibleApps]);

  const metadataMap = useContributorMetadata(profilePubkeys);

  useEffect(() => {
    if (leavingRef.current) return;
    if (!subscribe || visibleApps.length === 0) return;
    setAssetFetchSettled(false);
    const ids = new Set<string>();
    const hintRelays = new Set<string>();
    for (const app of visibleApps) {
      const list = releasesForApp(app);
      const best = pickLatestMainRelease(list);
      if (!best) continue;
      const { ids: assetIds, relayHints } =
        assetIdsAndRelayHintsFromRelease(best);
      for (const id of assetIds) {
        if (id) ids.add(id);
      }
      for (const h of relayHints) hintRelays.add(h);
    }
    requestAssetBatch(Array.from(ids), Array.from(hintRelays));
    const settleTimer = setTimeout(() => {
      if (!leavingRef.current) setAssetFetchSettled(true);
    }, 14000);
    return () => clearTimeout(settleTimer);
  }, [
    subscribe,
    visibleApps,
    releasesByApp,
    releasesByAppId,
    requestAssetBatch,
    releasesForApp,
  ]);

  const platformFilterOptions = useMemo(
    () => collectPlatformFilterOptions(apps),
    [apps]
  );
  const topicTagOptions = useMemo(() => collectTopicTagOptions(apps), [apps]);

  const filteredTopicChips = useMemo(() => {
    const q = topicChipQuery.trim().toLowerCase();
    if (!q) return topicTagOptions;
    return topicTagOptions.filter((t) => t.toLowerCase().includes(q));
  }, [topicTagOptions, topicChipQuery]);

  useEffect(() => {
    if (!topicsFilterOpen) setTopicChipQuery("");
  }, [topicsFilterOpen]);

  const showTagFilters =
    apps.length > 0 &&
    (platformFilterOptions.length > 0 || topicTagOptions.length > 0);

  return (
    <div className="min-h-[70vh]">
      <div className="relative overflow-hidden rounded-2xl border border-[#383B42] bg-gradient-to-br from-[#12151c] via-[#0e1116] to-[#0a0c10] px-6 py-10 md:px-10 md:py-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--color-accent-primary) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#383B42] bg-[#171B21]/80 px-3 py-1 text-xs font-medium text-gray-400">
              <Package
                className="h-3.5 w-3.5 text-[var(--color-accent-primary)]"
                aria-hidden
              />
              NIP-82 apps
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
              Apps on Nostr
            </h1>
            <p className="mt-3 text-base leading-relaxed text-gray-400">
              Installable software published to Nostr, newest announce first. No
              login or browser extension required — listings load from public
              relays (including{" "}
              <code className="text-gray-500">relay.zapstore.dev</code>).
              {pubkey ? (
                <>
                  {" "}
                  Manage yours in{" "}
                  <Link
                    href="/apps/mine"
                    className="text-[var(--color-accent-primary)] hover:underline"
                  >
                    Your Apps
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
          {!loading ? (
            <div className="flex shrink-0 flex-col items-start gap-1 rounded-xl border border-[#383B42] bg-[#171B21]/90 px-5 py-4 text-left md:items-end md:text-right">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Listed
              </span>
              <span className="text-3xl font-semibold tabular-nums text-white">
                {apps.length}
              </span>
              <span className="text-xs text-gray-500">applications</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 w-full pb-16">
        <div className="mb-8 rounded-xl border border-[#383B42] bg-[#0E1116]/90 p-4 shadow-lg shadow-black/20">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
              aria-hidden
            />
            <input
              aria-label="Search apps"
              className="w-full rounded-lg border border-[#383B42] bg-[#171B21] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-[var(--color-accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/40"
              disabled={loading && apps.length === 0}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, package id, author, or repo…"
              type="search"
              value={query}
            />
          </div>
        </div>

        {showTagFilters ? (
          <div className="mb-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Filter
              </span>
              <button
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  activeTag === null
                    ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/15 text-white"
                    : "border-[#383B42] bg-[#171B21]/80 text-gray-400 hover:border-gray-500"
                )}
                onClick={() => setActiveTag(null)}
              >
                All
              </button>
              {platformFilterOptions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    activeTag === tag
                      ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/15 text-white"
                      : "border-[#383B42] bg-[#171B21]/80 text-gray-400 hover:border-gray-500"
                  )}
                  onClick={() =>
                    setActiveTag((prev) => (prev === tag ? null : tag))
                  }
                >
                  {tag}
                </button>
              ))}
            </div>

            {topicTagOptions.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]/90">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[#171B21]/50"
                  aria-expanded={topicsFilterOpen}
                  onClick={() => setTopicsFilterOpen((o) => !o)}
                >
                  <span className="text-sm text-gray-300">
                    <span className="font-medium text-white">Topics</span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({topicTagOptions.length} labels — tap to browse)
                    </span>
                    {activeTag &&
                    topicTagOptions.includes(activeTag) &&
                    !platformFilterOptions.includes(activeTag) ? (
                      <span className="ml-2 text-xs font-medium text-[var(--color-accent-primary)]">
                        · {activeTag}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-gray-500 transition-transform",
                      topicsFilterOpen ? "rotate-180" : ""
                    )}
                    aria-hidden
                  />
                </button>
                {topicsFilterOpen ? (
                  <div className="border-t border-[#383B42]/70 px-3 pb-3 pt-2">
                    <input
                      aria-label="Filter topic list"
                      className="mb-3 w-full rounded-lg border border-[#383B42] bg-[#171B21] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-[var(--color-accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/40"
                      onChange={(e) => setTopicChipQuery(e.target.value)}
                      placeholder="Find a topic in the list…"
                      type="search"
                      value={topicChipQuery}
                    />
                    <div className="max-h-56 overflow-y-auto pr-1">
                      <div className="flex flex-wrap gap-2">
                        {filteredTopicChips.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            No topic matches “{topicChipQuery.trim()}”.
                          </p>
                        ) : (
                          filteredTopicChips.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                                activeTag === tag
                                  ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/15 text-white"
                                  : "border-[#383B42] bg-[#171B21]/80 text-gray-400 hover:border-gray-500"
                              )}
                              onClick={() =>
                                setActiveTag((prev) =>
                                  prev === tag ? null : tag
                                )
                              }
                            >
                              {tag}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {loading && apps.length === 0 && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading apps from relays…
          </div>
        )}

        {!loading && apps.length === 0 && (
          <div className="mb-4 space-y-3 rounded-lg border border-[#383B42] bg-[#171B21]/60 p-4">
            <p className="text-sm text-gray-400">
              {loadError ??
                "No applications returned yet. This page does not require signing in — data comes from Nostr relays."}
            </p>
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "border-[#383B42]"
              )}
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              Retry loading apps
            </button>
          </div>
        )}

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loading && apps.length === 0
            ? Array.from({ length: 9 }).map((_, i) => <CardSkeleton key={i} />)
            : visibleApps.map((app) => {
                const key = appDedupKey(app.pubkey, app.appId);
                const relList = releasesForApp(app);
                const latest = pickLatestMainRelease(relList);
                const assetEvents = getAssetEventsForApp(
                  app,
                  releasesByApp,
                  releasesByAppId,
                  assetsById
                );
                const labels = cardLabelsForApp(app, assetEvents);
                const apk = pickAndroidApkAsset(assetEvents);
                const officialApk = isOfficialGittrAndroidListing(app)
                  ? resolveOfficialGittrAppsApk({
                      nip82Version: latest?.version,
                      nip82Url: apk?.url,
                      githubVersion: gittrGithubLatest?.version,
                      githubUrl: gittrGithubLatest?.apkUrl,
                    })
                  : null;
                const apkVersion = officialApk?.version ?? latest?.version;
                const apkHref = officialApk?.url ?? apk?.url;
                const authorMeta = metadataMap[app.pubkey.toLowerCase()];
                const ghSpec = app.repository
                  ? parseGitHubRepoSpec(app.repository)
                  : null;
                const ghKey = ghSpec ? `${ghSpec.owner}/${ghSpec.repo}` : null;
                const gh = ghKey ? ghStats[ghKey] : undefined;

                return (
                  <li key={key}>
                    <SoftwareAppDirectoryCard
                      app={app}
                      authorMeta={authorMeta}
                      metadataMap={metadataMap}
                      labels={labels}
                      gh={gh}
                      footer={
                        <>
                          {apkHref ? (
                            <a
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "default",
                                }),
                                "shadow-sm"
                              )}
                              href={apkHref}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                              {apkVersion
                                ? `APK v${apkVersion}`
                                : "Download APK"}
                            </a>
                          ) : apk && !apk.url ? (
                            <span
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "outline",
                                }),
                                "cursor-not-allowed opacity-60"
                              )}
                              title="Asset has no URL on this relay set; open in Zapstore or use a Blossom lookup by hash."
                            >
                              APK (hash only)
                            </span>
                          ) : latest && latest.assetEventIds.length > 0 ? (
                            assetFetchSettled ? (
                              <span
                                className={cn(
                                  buttonVariants({
                                    size: "sm",
                                    variant: "outline",
                                  }),
                                  "cursor-default opacity-80"
                                )}
                                title="Kind 3063 asset events were not found on the catalog relay set. Try again later or open the publisher’s Blossom / Zapstore listing."
                              >
                                Assets not on catalog relays
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  buttonVariants({
                                    size: "sm",
                                    variant: "outline",
                                  }),
                                  "cursor-wait opacity-80"
                                )}
                              >
                                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                                Resolving assets…
                              </span>
                            )
                          ) : (
                            <span
                              className="text-xs text-gray-500"
                              title={
                                "Releases are kind 30063 on relays; they point at kind 3063 assets. " +
                                "APK bytes are often on Blossom or a CDN URL inside the asset event once relays return it — " +
                                "they are not ‘on Blossom’ instead of Nostr; both work together."
                              }
                            >
                              No release on relays
                            </span>
                          )}

                          <SoftwareAppSourceButtons app={app} />
                        </>
                      }
                    />
                  </li>
                );
              })}
        </ul>
        <LoadMoreButton
          visibleCount={shownCount}
          totalCount={filteredApps.length}
          pageSize={REPO_LIST_PAGE_SIZE}
          onLoadMore={() => setVisibleCount((n) => n + REPO_LIST_PAGE_SIZE)}
        />

        <div className="mt-12 flex flex-wrap gap-3 border-t border-[#383B42] pt-10">
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/explore"
            onClick={(e) => appNavigate("/explore", router, pathname, e)}
          >
            Repos
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/pages"
            onClick={(e) => appNavigate("/pages", router, pathname, e)}
          >
            Pages
          </Link>
        </div>
      </div>
    </div>
  );
}
