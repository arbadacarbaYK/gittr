"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  parseGitHubRepoSpec,
  repositoryUrlToReleasesHref,
} from "@/lib/nostr/nip82-repository-links";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareApp,
  type ParsedSoftwareAsset,
  type ParsedSoftwareRelease,
  appDedupKey,
  dedupeSoftwareApps,
  mimeToKindLabel,
  parseSoftwareAsset,
  parseSoftwareRelease,
  pickAndroidApkAsset,
  pickLatestMainRelease,
  platformHintToLabel,
} from "@/lib/nostr/nip82-software";
import { relaysForSoftwareCatalog } from "@/lib/nostr/software-catalog-relays";
import {
  type Metadata,
  useContributorMetadata,
} from "@/lib/nostr/useContributorMetadata";
import { cn } from "@/lib/utils";

import {
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Search,
} from "lucide-react";
import Link from "next/link";
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

function profileDisplayName(
  meta: Metadata | undefined,
  fallbackNpubShort: string
): string {
  if (!meta) return fallbackNpubShort;
  const d = meta.display_name?.trim();
  const n = meta.name?.trim();
  if (d) return d;
  if (n) return n;
  return fallbackNpubShort;
}

function npubForTitle(hex: string): string {
  try {
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      return nip19.npubEncode(hex);
    }
  } catch {
    // ignore
  }
  return hex;
}

function formatStarCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const s = k >= 10 ? k.toFixed(0) : k.toFixed(1);
  return `${s.replace(/\.0$/, "")}k`;
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
  const { subscribe, defaultRelays } = useNostrContext();
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

  const rawAppEventsRef = useRef<NostrEventLike[]>([]);
  const releasesRef = useRef<Map<string, ParsedSoftwareRelease[]>>(new Map());
  const releasesByAppIdRef = useRef<Map<string, ParsedSoftwareRelease[]>>(
    new Map()
  );
  const assetsRef = useRef<Set<string>>(new Set());
  const assetSubUnsubsRef = useRef<Array<() => void>>([]);

  const relays = useMemo(
    () => relaysForSoftwareCatalog(defaultRelays),
    [defaultRelays]
  );
  const relaysKey = useMemo(() => relays.join("|"), [relays]);

  const refreshAppsFromRef = useCallback(() => {
    const map = dedupeSoftwareApps(rawAppEventsRef.current);
    setApps(
      Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      )
    );
  }, []);

  const mergeReleaseEvent = useCallback((event: NostrEventLike) => {
    if (isPublisherBlocklisted(event.pubkey)) return;
    const r = parseSoftwareRelease(event);
    if (!r) return;
    const key = appDedupKey(r.pubkey, r.appId);
    upsertReleaseInMap(releasesRef.current, key, r);
    upsertReleaseInMap(releasesByAppIdRef.current, r.appId, r);
    setReleasesByApp(new Map(releasesRef.current));
    setReleasesByAppId(new Map(releasesByAppIdRef.current));
  }, []);

  const applyServerCatalog = useCallback(
    (data: {
      apps?: ParsedSoftwareApp[];
      releasesByApp?: Record<string, ParsedSoftwareRelease[]>;
      releasesByAppId?: Record<string, ParsedSoftwareRelease[]>;
    }) => {
      if (data.apps?.length) {
        for (const a of data.apps) {
          rawAppEventsRef.current.push(
            a.raw ?? {
              id: "",
              pubkey: a.pubkey,
              kind: KIND_SOFTWARE_APPLICATION,
              created_at: a.createdAt,
              content: a.content,
              tags: [],
            }
          );
        }
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
    },
    [refreshAppsFromRef]
  );

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
      };
      applyServerCatalog(data);
      return (data.apps?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }, [applyServerCatalog]);

  const profilePubkeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of apps) {
      if (/^[0-9a-f]{64}$/i.test(a.pubkey)) {
        s.add(a.pubkey.toLowerCase());
      }
      for (const p of a.attributedPubkeys) {
        s.add(p);
      }
    }
    return Array.from(s);
  }, [apps]);

  const metadataMap = useContributorMetadata(profilePubkeys);

  const githubRepoKeys = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const a of apps) {
      if (!a.repository) continue;
      const spec = parseGitHubRepoSpec(a.repository);
      if (!spec) continue;
      const k = `${spec.owner}/${spec.repo}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(k);
    }
    return ordered.sort();
  }, [apps]);

  const [ghStats, setGhStats] = useState<
    Record<string, { stars: number; forks: number }>
  >({});

  useEffect(() => {
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
          if (!cancelled && data?.stats) setGhStats(data.stats);
        }
      )
      .catch(() => {
        if (!cancelled) setGhStats({});
      });
    return () => {
      cancelled = true;
    };
  }, [githubRepoKeys.join(",")]);

  const requestAssetBatch = useCallback(
    (ids: string[]) => {
      if (!subscribe || ids.length === 0) return;
      const missing = ids.filter((id) => !assetsRef.current.has(id));
      if (missing.length === 0) return;
      const chunkSize = 350;
      for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize);
        const unsub = subscribe(
          [{ kinds: [KIND_SOFTWARE_ASSET], ids: chunk }],
          relays,
          (event: NostrEventLike) => {
            const a = parseSoftwareAsset(event);
            if (!a) return;
            assetsRef.current.add(a.id);
            setAssetsById((prev) => {
              if (prev.has(a.id)) return prev;
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
    rawAppEventsRef.current = [];
    releasesRef.current = new Map();
    releasesByAppIdRef.current = new Map();
    assetsRef.current = new Set();
    setApps([]);
    setReleasesByApp(new Map());
    setReleasesByAppId(new Map());
    setAssetsById(new Map());
    setLoading(true);
    setLoadError(null);

    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const stopTimer = setTimeout(() => {
      finishLoading();
    }, 18000);

    void (async () => {
      const ok = await fetchCatalogFromServer();
      if (cancelled) return;
      if (ok) finishLoading();
    })();

    const unsub = subscribe
      ? subscribe(
          [
            { kinds: [KIND_SOFTWARE_APPLICATION], limit: 4000 },
            { kinds: [KIND_SOFTWARE_RELEASE], limit: 12000 },
          ],
          relays,
          (event: NostrEventLike) => {
            if (cancelled) return;
            if (event.kind === KIND_SOFTWARE_APPLICATION) {
              if (!isPublisherBlocklisted(event.pubkey)) {
                rawAppEventsRef.current.push(event);
                refreshAppsFromRef();
              }
              finishLoading();
              return;
            }
            if (event.kind === KIND_SOFTWARE_RELEASE) {
              mergeReleaseEvent(event);
            }
          },
          16000
        )
      : () => {};

    return () => {
      cancelled = true;
      clearTimeout(stopTimer);
      unsub();
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
    mergeReleaseEvent,
  ]);

  useEffect(() => {
    if (loading || apps.length > 0) return;
    void fetchCatalogFromServer().then((ok) => {
      if (!ok) {
        setLoadError(
          "Could not load apps from Nostr relays. Try again — no login or extension is required."
        );
      }
    });
  }, [loading, apps.length, fetchCatalogFromServer]);

  const releasesForApp = useCallback(
    (app: ParsedSoftwareApp): ParsedSoftwareRelease[] => {
      const strictKey = appDedupKey(app.pubkey, app.appId);
      const strict = releasesByApp.get(strictKey);
      if (strict && strict.length > 0) return strict;
      return releasesByAppId.get(app.appId) ?? [];
    },
    [releasesByApp, releasesByAppId]
  );

  useEffect(() => {
    if (!subscribe || apps.length === 0) return;
    const ids = new Set<string>();
    for (const app of apps) {
      const list = releasesForApp(app);
      const best = pickLatestMainRelease(list);
      if (!best) continue;
      for (const id of best.assetEventIds) {
        if (id) ids.add(id);
      }
    }
    requestAssetBatch(Array.from(ids));
  }, [
    subscribe,
    apps,
    releasesByApp,
    releasesByAppId,
    requestAssetBatch,
    releasesForApp,
  ]);

  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [topicsFilterOpen, setTopicsFilterOpen] = useState(false);
  const [topicChipQuery, setTopicChipQuery] = useState("");

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = apps;
    if (q) {
      list = list.filter((a) => {
        const pk = a.pubkey.toLowerCase();
        const meta = metadataMap[pk];
        const authorLabel = profileDisplayName(meta, shortNpub(a.pubkey));
        const contribLabels = a.attributedPubkeys
          .map((hex) => profileDisplayName(metadataMap[hex], shortNpub(hex)))
          .join(" ");
        const hay = [
          a.name,
          a.summary,
          a.appId,
          a.repository,
          a.webUrl,
          a.content,
          a.license,
          shortNpub(a.pubkey),
          authorLabel,
          meta?.nip05,
          contribLabels,
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
  }, [
    apps,
    query,
    activeTag,
    releasesByApp,
    releasesByAppId,
    assetsById,
    metadataMap,
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
              Installable software published to Nostr. No login or browser
              extension required — listings load from public relays (including{" "}
              <code className="text-gray-500">relay.zapstore.dev</code>).
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

      <div className="mx-auto mt-8 w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mb-8 rounded-xl border border-[#383B42] bg-[#0E1116]/90 p-4 shadow-lg shadow-black/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
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

        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {loading && apps.length === 0
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : filteredApps.map((app) => {
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
                const npubShort = shortNpub(app.pubkey);
                const authorMeta = metadataMap[app.pubkey.toLowerCase()];
                const authorLabel = profileDisplayName(authorMeta, npubShort);
                const ghSpec = app.repository
                  ? parseGitHubRepoSpec(app.repository)
                  : null;
                const ghKey = ghSpec ? `${ghSpec.owner}/${ghSpec.repo}` : null;
                const gh = ghKey ? ghStats[ghKey] : undefined;
                const profileHref =
                  app.pubkey && /^[0-9a-f]{64}$/i.test(app.pubkey)
                    ? `/${nip19.npubEncode(app.pubkey)}`
                    : `/${app.pubkey}`;

                return (
                  <li key={key}>
                    <article
                      className={cn(
                        "group relative flex h-full min-h-[10rem] gap-4 overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]/95 p-5 shadow-md transition",
                        "hover:-translate-y-0.5 hover:border-[var(--color-accent-primary)]/50 hover:shadow-lg hover:shadow-[var(--color-accent-primary)]/5"
                      )}
                    >
                      <div className="shrink-0">
                        {app.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt=""
                            className="h-16 w-16 rounded-xl border border-[#383B42]/80 bg-[#171B21] object-cover"
                            height={64}
                            src={app.icon}
                            width={64}
                          />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[#383B42]/80 bg-[#171B21]">
                            <Package className="h-8 w-8 text-gray-600" />
                          </div>
                        )}
                      </div>
                      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
                          {app.name}
                        </h2>
                        <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
                          {app.appId}
                        </p>
                        <div className="mt-1 flex min-w-0 items-start gap-2">
                          {authorMeta?.picture &&
                          authorMeta.picture.startsWith("http") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt=""
                              className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[#383B42]/80 object-cover"
                              height={28}
                              src={authorMeta.picture}
                              width={28}
                            />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <Link
                              className="block truncate text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
                              href={profileHref}
                              title={`${authorLabel} · ${npubForTitle(
                                app.pubkey
                              )}`}
                            >
                              {authorLabel}
                            </Link>
                            {authorMeta?.nip05?.trim() ? (
                              <p
                                className="truncate text-[11px] text-gray-500"
                                title={authorMeta.nip05}
                              >
                                {authorMeta.nip05}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        {app.attributedPubkeys.length > 0 ? (
                          <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
                            <span className="text-gray-600">With </span>
                            {app.attributedPubkeys.slice(0, 3).map((pk, i) => (
                              <span key={pk}>
                                {i > 0 ? ", " : ""}
                                {profileDisplayName(
                                  metadataMap[pk],
                                  shortNpub(pk)
                                )}
                              </span>
                            ))}
                            {app.attributedPubkeys.length > 3
                              ? ` +${app.attributedPubkeys.length - 3}`
                              : ""}
                          </p>
                        ) : null}
                        {gh || app.license ? (
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                            {gh ? (
                              <span title="From GitHub public API (stars / forks)">
                                ⭐ {formatStarCount(gh.stars)}
                                {gh.forks > 0
                                  ? ` · ${formatStarCount(gh.forks)} forks`
                                  : ""}
                              </span>
                            ) : null}
                            {app.license ? (
                              <span
                                className="rounded border border-[#383B42]/80 bg-[#171B21]/60 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
                                title="SPDX license (NIP-82)"
                              >
                                {app.license}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        {labels.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {labels.map((lb) => (
                              <span
                                key={lb}
                                className="rounded-full border border-[#383B42] bg-[#171B21]/90 px-2 py-0.5 text-[11px] font-medium text-gray-400"
                              >
                                {lb}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {app.summary ? (
                          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-400">
                            {app.summary}
                          </p>
                        ) : null}

                        <div className="mt-auto flex flex-wrap gap-2 border-t border-[#383B42]/60 pt-4">
                          {apk?.url ? (
                            <a
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "default",
                                }),
                                "shadow-sm"
                              )}
                              href={apk.url}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                              {latest
                                ? `APK v${latest.version}`
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

                          {app.repository ? (
                            <a
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "outline",
                                })
                              )}
                              href={repositoryUrlToReleasesHref(app.repository)}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              Releases
                              <ExternalLink className="ml-1.5 h-3 w-3" />
                            </a>
                          ) : null}
                          {app.webUrl ? (
                            <a
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "outline",
                                })
                              )}
                              href={app.webUrl}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              Website
                              <ExternalLink className="ml-1.5 h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
        </ul>

        <div className="mt-12 flex flex-wrap gap-3 border-t border-[#383B42] pt-10">
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/explore"
          >
            Repos
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/pages"
          >
            Pages
          </Link>
        </div>
      </div>
    </div>
  );
}
