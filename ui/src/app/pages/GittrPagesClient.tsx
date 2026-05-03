"use client";

import { useEffect, useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  authorSearchTokens,
  cardAuthorPrimary,
  cardAuthorTooltip,
} from "@/lib/gittr-pages/author-card-label";
import { pagesCardPreviewUrl } from "@/lib/gittr-pages/card-preview-url";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import { cn } from "@/lib/utils";

import { ExternalLink, Globe, Loader2, Search, Zap } from "lucide-react";
import Link from "next/link";

type ApiPayload = {
  pagesBase: string;
  statusUrl: string;
  manifestsUrl?: string;
  source?: "json" | "html";
  sites: GatewayStatusSiteRow[];
  meta: { siteCount: number | null; generatedAt: string | null };
  error?: string;
};

type GittrPagesClientProps = {
  pagesBase: string;
};

function CardSkeleton() {
  return (
    <li className="animate-pulse rounded-xl border border-[#383B42]/80 bg-[#0E1116]/60 p-4">
      <div className="h-5 w-[78%] max-w-[14rem] rounded bg-gray-800" />
      <div className="mt-3 h-4 w-1/2 rounded bg-gray-800/80" />
      <div className="mt-4 h-9 w-28 rounded-md bg-gray-800" />
    </li>
  );
}

export function GittrPagesClient({ pagesBase }: GittrPagesClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/gittr-pages/status-sites")
      .then(async (res) => {
        const data = (await res.json()) as ApiPayload & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (!cancelled) {
          setPayload(data);
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
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        s.updatedLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [payload, query]);

  const base = pagesBase.replace(/\/$/, "");
  const statusPageUrl = `${base}/status`;
  const count = payload?.meta?.siteCount ?? payload?.sites?.length;

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
              gittr Pages
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
              Published sites
            </h1>
            <p className="mt-3 text-base leading-relaxed text-gray-400">
              Every card is a live site on our gateway.{" "}
              <strong className="text-gray-200">Open site</strong> always opens
              in a new tab so you keep gittr open here.
            </p>
          </div>
          {typeof count === "number" && !loading && !error ? (
            <div className="flex shrink-0 flex-col items-start gap-1 rounded-xl border border-[#383B42] bg-[#171B21]/90 px-5 py-4 text-left md:items-end md:text-right">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                On gateway
              </span>
              <span className="text-3xl font-semibold tabular-nums text-white">
                {count}
              </span>
              <span className="text-xs text-gray-500">sites listed</span>
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

      <div className="mx-auto mt-8 max-w-5xl px-4 pb-16">
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
            Full table and per-path breakdown:{" "}
            <a
              className="font-medium text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
              href={statusPageUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              gateway status
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
            </a>
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
          </p>
        )}

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : filtered.map((s) => {
                const previewUrl = pagesCardPreviewUrl(s.siteUrl);
                const authorPrimary = cardAuthorPrimary(s);
                const authorTip = cardAuthorTooltip(s);
                return (
                  <li key={`${s.siteUrl}-${s.pathsStatusUrl}`}>
                    <article
                      className={cn(
                        "group relative flex h-full min-h-[14rem] flex-col overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]/95 shadow-md transition",
                        "hover:-translate-y-0.5 hover:border-[var(--color-accent-primary)]/50 hover:shadow-lg hover:shadow-[var(--color-accent-primary)]/5"
                      )}
                    >
                      {previewUrl ? (
                        <>
                          {/* Remote snapshot; disable Next/Image (unknown hosts). */}
                          <img
                            alt=""
                            aria-hidden
                            className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-top opacity-[0.2] transition duration-300 group-hover:opacity-[0.26]"
                            decoding="async"
                            loading="lazy"
                            src={previewUrl}
                            onError={(e) => {
                              e.currentTarget.remove();
                            }}
                          />
                          <div
                            aria-hidden
                            className="absolute inset-0 z-[1] bg-gradient-to-b from-[#0a0c10]/94 via-[#0e1116]/88 to-[#0e1116]/96"
                          />
                        </>
                      ) : null}
                      <div className="relative z-10 flex h-full flex-col p-5">
                        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
                          {s.title}
                        </h2>
                        {authorPrimary ? (
                          <p
                            className="mt-2 truncate text-sm text-gray-400"
                            title={authorTip || undefined}
                          >
                            {authorPrimary}
                          </p>
                        ) : null}
                        {s.description ? (
                          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-300">
                            {s.description}
                          </p>
                        ) : null}
                        <p className="mt-3 text-xs text-gray-500">
                          {s.pathCount} path{s.pathCount === 1 ? "" : "s"} ·{" "}
                          {s.hits} hit{s.hits === 1 ? "" : "s"}
                          {s.updatedLabel ? ` · ${s.updatedLabel}` : ""}
                        </p>
                        <div className="mt-auto flex flex-wrap gap-2 border-t border-[#383B42]/60 pt-4">
                          <a
                            className={cn(
                              buttonVariants({ size: "sm", variant: "default" }),
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
