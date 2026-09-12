"use client";

import { useEffect, useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { TrustBadge } from "@/components/ui/trust-badge";
import {
  authorPubkeyHexNormalized,
  authorSearchTokens,
  cardAuthorPrimary,
  cardAuthorProfileHref,
  cardAuthorTooltip,
  formatPagesStatCount,
  siteHostname,
  siteKindLabel,
} from "@/lib/gittr-pages/author-card-label";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import { pickProfileDisplayName } from "@/lib/nostr/kind0-profile-fields";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import {
  REPO_LIST_PAGE_SIZE,
  clampVisibleCount,
} from "@/lib/ui/list-pagination";
import { cn } from "@/lib/utils";
import { isDisplayableProfilePicture } from "@/lib/utils/entity-resolver";

import { ExternalLink, Globe, Loader2, Search, Zap } from "lucide-react";
import Link from "next/link";

type ApiPayload = {
  pagesBase: string;
  statusUrl: string;
  manifestsUrl?: string;
  source?: "json" | "html";
  sites: GatewayStatusSiteRow[];
  total?: number;
  hasMore?: boolean;
  meta: { siteCount: number | null; generatedAt: string | null };
  error?: string;
};

type GittrPagesClientProps = {
  pagesBase: string;
};

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

export function GittrPagesClient({ pagesBase }: GittrPagesClientProps) {
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(REPO_LIST_PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisibleCount(REPO_LIST_PAGE_SIZE);

    const apply = (data: ApiPayload) => {
      if (cancelled) return;
      setPayload(data);
    };

    // First page only so cards can paint without waiting on ~2000 rows.
    fetch(`/api/gittr-pages/status-sites?limit=${REPO_LIST_PAGE_SIZE}`)
      .then(async (res) => {
        const data = (await res.json()) as ApiPayload & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        apply(data);
        if (!cancelled) {
          setLoading(false);
        }
        if (data.hasMore === false) {
          return;
        }
        if (!cancelled) {
          setHydrating(true);
        }
        try {
          const rest = await fetch("/api/gittr-pages/status-sites");
          const full = (await rest.json()) as ApiPayload & { error?: string };
          if (!rest.ok) {
            console.warn(
              "[pages] Full directory hydrate failed:",
              full.error || rest.status
            );
            return;
          }
          apply(full);
        } catch (hydrateErr) {
          console.warn("[pages] Full directory hydrate failed:", hydrateErr);
        } finally {
          if (!cancelled) {
            setHydrating(false);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load sites");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setHydrating(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setVisibleCount(REPO_LIST_PAGE_SIZE);
  }, [query]);

  const filtered = useMemo(() => {
    const sites = payload?.sites ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return sites;
    }
    return sites.filter((s) => {
      const hay = [
        s.title,
        authorSearchTokens(s),
        s.description,
        s.siteUrl,
        siteHostname(s.siteUrl),
        siteKindLabel(s.siteKind),
        s.updatedLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [payload, query]);

  const shownCount = clampVisibleCount(visibleCount, filtered.length);
  const visible = useMemo(
    () => filtered.slice(0, shownCount),
    [filtered, shownCount]
  );

  const profilePubkeys = useMemo(() => {
    const ids = new Set<string>();
    for (const row of visible) {
      const hex = authorPubkeyHexNormalized(row.authorPubkeyHex);
      if (hex) ids.add(hex);
    }
    return Array.from(ids);
  }, [visible]);
  const metadataMap = useContributorMetadata(profilePubkeys);

  const base = pagesBase.replace(/\/$/, "");
  const statusPageUrl = `${base}/status`;
  const count =
    payload?.meta?.siteCount ?? payload?.total ?? payload?.sites?.length;

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
              <Globe
                className="h-3.5 w-3.5 text-[var(--color-accent-primary)]"
                aria-hidden
              />
              Nostr Pages
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
              Published sites
            </h1>
            <p className="mt-3 text-base leading-relaxed text-gray-400">
              Live sites you can open in a new tab. Only entries with a root{" "}
              <code className="text-gray-300">index.html</code> are listed here
              (manifest-only Blossom uploads without a homepage are omitted).
            </p>
          </div>
          {typeof count === "number" && !loading && !error ? (
            <div className="flex shrink-0 flex-col items-start gap-1 rounded-xl border border-[#383B42] bg-[#171B21]/90 px-5 py-4 text-left md:items-end md:text-right">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Live sites
              </span>
              <span className="text-3xl font-semibold tabular-nums text-white">
                {count}
              </span>
              <span className="text-xs text-gray-500">with a homepage</span>
            </div>
          ) : null}
        </div>
        {payload?.meta?.generatedAt ? (
          <p className="relative mt-4 text-sm text-gray-500">
            Data snapshot: {payload.meta.generatedAt}
            {payload.source === "json" ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-950/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300/90">
                <Zap className="h-3 w-3" aria-hidden />
                JSON API
              </span>
            ) : payload.source === "html" ? (
              <span className="ml-2 text-[11px] text-amber-200/80">
                (HTML fallback — deploy gittr gateway fork for JSON)
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-8 w-full pb-16">
        <div className="mb-8 rounded-xl border border-[#383B42] bg-[#0E1116]/90 p-4 shadow-lg shadow-black/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              aria-label="Search sites"
              className="w-full rounded-lg border border-[#383B42] bg-[#171B21] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-[var(--color-accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/40"
              disabled={loading || !!error}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by site name, author, or description…"
              type="search"
              value={query}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            <a
              className="font-medium text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
              href={statusPageUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open on gateway
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
            </a>
            <span className="text-gray-600"> · </span>
            <Link
              className="font-medium text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
              href="/pages"
            >
              Open on gittr
            </Link>
            <span className="text-gray-600">
              {" "}
              — gateway status includes file-only manifests; this page lists
              homepages only.
            </span>
            {payload?.manifestsUrl ? (
              <>
                {" "}
                ·{" "}
                <a
                  className="text-gray-400 underline-offset-2 hover:text-gray-300 hover:underline"
                  href={payload.manifestsUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  manifests.json
                </a>
              </>
            ) : null}
          </p>
        </div>

        {loading && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading from gateway…
          </div>
        )}
        {!loading && hydrating ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading the rest of the directory…
          </div>
        ) : null}

        {error && (
          <div
            className="mb-6 rounded-xl border border-red-900/40 px-4 py-3 text-sm text-red-100"
            style={{ background: "rgba(60, 10, 10, 0.35)" }}
          >
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-gray-500">
            No sites match your search. Clear the box to see the full list.
            {hydrating
              ? " Still loading remaining sites — try again in a moment."
              : ""}
          </p>
        )}

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 9 }).map((_, i) => <CardSkeleton key={i} />)
            : visible.map((s) => {
                const authorPrimary = cardAuthorPrimary(s);
                const authorTip = cardAuthorTooltip(s);
                const authorHref = cardAuthorProfileHref(s);
                const authorHex = authorPubkeyHexNormalized(s.authorPubkeyHex);
                const authorMeta = authorHex
                  ? metadataMap[authorHex]
                  : undefined;
                const authorLabel =
                  pickProfileDisplayName(authorMeta) || authorPrimary;
                const host = siteHostname(s.siteUrl);
                const kindLbl = siteKindLabel(s.siteKind);
                return (
                  <li key={`${s.siteUrl}-${s.pathsStatusUrl}`}>
                    <article
                      className={cn(
                        "group relative flex h-full min-h-[10rem] gap-4 overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]/95 p-5 shadow-md transition",
                        "hover:-translate-y-0.5 hover:border-[var(--color-accent-primary)]/50 hover:shadow-lg hover:shadow-[var(--color-accent-primary)]/5"
                      )}
                    >
                      <div className="shrink-0">
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[#383B42]/80 bg-[#171B21]">
                          <Globe className="h-8 w-8 text-gray-600" />
                        </div>
                      </div>
                      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
                          {s.title}
                        </h2>
                        {host ? (
                          <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
                            {host}
                          </p>
                        ) : null}
                        {authorLabel ? (
                          <div className="mt-1 flex min-w-0 items-start gap-2">
                            {authorHref ? (
                              <a
                                className="flex min-w-0 flex-1 items-start gap-2 rounded-md outline-offset-2 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-primary)]"
                                href={authorHref}
                                rel="noopener noreferrer"
                                target="_blank"
                                title={authorTip || undefined}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  alt=""
                                  className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[#383B42]/80 bg-[#22262C] object-cover"
                                  height={28}
                                  src={
                                    authorMeta?.picture &&
                                    isDisplayableProfilePicture(
                                      authorMeta.picture
                                    )
                                      ? authorMeta.picture
                                      : "/logo.svg"
                                  }
                                  width={28}
                                  onError={(e) => {
                                    const el = e.currentTarget;
                                    if (!el.src.endsWith("/logo.svg")) {
                                      el.src = "/logo.svg";
                                    }
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-[var(--color-accent-primary)] hover:underline">
                                    {authorLabel}
                                  </span>
                                  {authorMeta?.nip05?.trim() ? (
                                    <p
                                      className="truncate text-[11px] text-gray-500"
                                      title={authorMeta.nip05}
                                    >
                                      {authorMeta.nip05}
                                    </p>
                                  ) : null}
                                  {authorHex ? (
                                    <div className="mt-1">
                                      <TrustBadge targetPubkey={authorHex} />
                                    </div>
                                  ) : null}
                                </div>
                              </a>
                            ) : (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  alt=""
                                  className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[#383B42]/80 bg-[#22262C] object-cover"
                                  height={28}
                                  src="/logo.svg"
                                  width={28}
                                />
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-gray-400">
                                    {authorLabel}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                        {kindLbl ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-full border border-[#383B42] bg-[#171B21]/90 px-2 py-0.5 text-[11px] font-medium text-gray-400">
                              {kindLbl}
                            </span>
                          </div>
                        ) : null}
                        {s.description ? (
                          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-400">
                            {s.description}
                          </p>
                        ) : null}
                        <p
                          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500"
                          title={s.updatedIso || undefined}
                        >
                          <span>
                            {formatPagesStatCount(s.pathCount)} path
                            {s.pathCount === 1 ? "" : "s"}
                          </span>
                          {s.snapshots > 0 ? (
                            <span>
                              {formatPagesStatCount(s.snapshots)} snapshot
                              {s.snapshots === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          <span>
                            {formatPagesStatCount(s.hits)} hit
                            {s.hits === 1 ? "" : "s"}
                          </span>
                          {s.updatedLabel ? (
                            <span>{s.updatedLabel}</span>
                          ) : null}
                        </p>
                        <div className="mt-auto flex flex-wrap gap-2 border-t border-[#383B42]/60 pt-4">
                          <a
                            className={cn(
                              buttonVariants({
                                size: "sm",
                                variant: "default",
                              }),
                              "shadow-sm"
                            )}
                            href={s.siteUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            Open site
                            <ExternalLink className="ml-1.5 h-3 w-3" />
                          </a>
                          <a
                            className={cn(
                              buttonVariants({ size: "sm", variant: "outline" })
                            )}
                            href={s.pathsStatusUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            Details
                            <ExternalLink className="ml-1.5 h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
        </ul>

        {!loading && !error ? (
          <LoadMoreButton
            visibleCount={shownCount}
            totalCount={filtered.length}
            pageSize={REPO_LIST_PAGE_SIZE}
            onLoadMore={() => setVisibleCount((n) => n + REPO_LIST_PAGE_SIZE)}
            className="mt-8 flex justify-center"
          />
        ) : null}

        <div className="mt-12 flex flex-wrap gap-3 border-t border-[#383B42] pt-10">
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/repositories"
          >
            Back to repositories
          </Link>
        </div>
      </div>
    </div>
  );
}
