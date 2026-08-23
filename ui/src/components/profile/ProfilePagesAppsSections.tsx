"use client";

import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import {
  type ParsedSoftwareApp,
  appDedupKey,
} from "@/lib/nostr/nip82-software";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";
import { cn } from "@/lib/utils";

import { ExternalLink, Globe, Smartphone } from "lucide-react";
import Link from "next/link";
import { nip19 } from "nostr-tools";

type ProfilePagesAppsSectionsProps = {
  /** Full 64-char hex pubkey of the profile owner */
  ownerPubkeyHex: string | null | undefined;
  /** Optional: surface counts for the profile stats row */
  onCountsChange?: (counts: { pages: number; apps: number }) => void;
};

function appBelongsToOwner(app: ParsedSoftwareApp, ownerHex: string): boolean {
  const h = ownerHex.toLowerCase();
  if (app.pubkey.toLowerCase() === h) return true;
  return (app.attributedPubkeys || []).some((p) => p.toLowerCase() === h);
}

/** Match Pages rows via authorPubkeyHex or npub… hostname (gateway convention). */
function pageBelongsToOwner(
  site: GatewayStatusSiteRow,
  ownerHex: string
): boolean {
  const h = ownerHex.toLowerCase();
  if (site.authorPubkeyHex?.toLowerCase() === h) return true;
  try {
    const first = new URL(site.siteUrl).hostname.split(".")[0]?.trim() ?? "";
    if (!first.toLowerCase().startsWith("npub1")) return false;
    const decoded = nip19.decode(first);
    return (
      decoded.type === "npub" &&
      typeof decoded.data === "string" &&
      decoded.data.toLowerCase() === h
    );
  } catch {
    return false;
  }
}

function runWhenIdle(fn: () => void, timeoutMs: number): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(fn, Math.min(timeoutMs, 1500));
  return () => window.clearTimeout(t);
}

/**
 * Profile sections for this person's Nostr Pages (gateway) and Apps (NIP-82).
 * Mirrors the stacked Repositories block style — not tabs.
 *
 * Load order: wait for browser idle (after repos/meta paint), then Pages HTTP,
 * then author-scoped Apps — so the full Zapstore scrape does not fight profile-repos.
 */
export function ProfilePagesAppsSections({
  ownerPubkeyHex,
  onCountsChange,
}: ProfilePagesAppsSectionsProps) {
  const ownerHex =
    ownerPubkeyHex && /^[0-9a-f]{64}$/i.test(ownerPubkeyHex)
      ? ownerPubkeyHex.toLowerCase()
      : null;

  const onCountsRef = useRef(onCountsChange);
  onCountsRef.current = onCountsChange;
  const lastCountsRef = useRef<{ pages: number; apps: number } | null>(null);

  const [pagesLoading, setPagesLoading] = useState(false);
  const [appsLoading, setAppsLoading] = useState(false);
  const [pages, setPages] = useState<GatewayStatusSiteRow[]>([]);
  const [apps, setApps] = useState<ParsedSoftwareApp[]>([]);
  const [visiblePages, setVisiblePages] = useState(REPO_LIST_PAGE_SIZE);
  const [visibleApps, setVisibleApps] = useState(REPO_LIST_PAGE_SIZE);

  useEffect(() => {
    setVisiblePages(REPO_LIST_PAGE_SIZE);
    setVisibleApps(REPO_LIST_PAGE_SIZE);
  }, [ownerHex]);

  useEffect(() => {
    if (!ownerHex) {
      setPages([]);
      setApps([]);
      lastCountsRef.current = { pages: 0, apps: 0 };
      onCountsRef.current?.({ pages: 0, apps: 0 });
      return;
    }

    let cancelled = false;
    setPages([]);
    setApps([]);
    lastCountsRef.current = { pages: 0, apps: 0 };
    onCountsRef.current?.({ pages: 0, apps: 0 });

    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      setPagesLoading(true);
      setAppsLoading(true);

      void (async () => {
        try {
          const pagesRes = await fetch("/api/gittr-pages/status-sites");
          const pagesData = (await pagesRes.json()) as {
            sites?: GatewayStatusSiteRow[];
            error?: string;
          };
          if (cancelled) return;
          if (!pagesRes.ok) throw new Error(pagesData.error || `pages ${pagesRes.status}`);
          setPages(
            (pagesData.sites || []).filter((s) => pageBelongsToOwner(s, ownerHex))
          );
        } catch {
          if (!cancelled) setPages([]);
        } finally {
          if (!cancelled) setPagesLoading(false);
        }

        if (cancelled) return;

        try {
          // Author-scoped catalog — avoids scraping 4k Zapstore apps on every profile.
          const appsRes = await fetch(
            `/api/nostr/software-catalog?author=${encodeURIComponent(ownerHex)}`
          );
          const appsData = (await appsRes.json()) as {
            apps?: ParsedSoftwareApp[];
            error?: string;
          };
          if (cancelled) return;
          if (!appsRes.ok) throw new Error(appsData.error || `apps ${appsRes.status}`);
          const mine = (appsData.apps || []).filter((a) =>
            appBelongsToOwner(a, ownerHex)
          );
          const seen = new Set<string>();
          const unique: ParsedSoftwareApp[] = [];
          for (const a of mine) {
            const k = appDedupKey(a.pubkey, a.appId);
            if (seen.has(k)) continue;
            seen.add(k);
            unique.push(a);
          }
          unique.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setApps(unique);
        } catch {
          if (!cancelled) setApps([]);
        } finally {
          if (!cancelled) setAppsLoading(false);
        }
      })();
    }, 4000);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [ownerHex]);

  useEffect(() => {
    if (pagesLoading || appsLoading) return;
    const next = { pages: pages.length, apps: apps.length };
    const prev = lastCountsRef.current;
    if (prev && prev.pages === next.pages && prev.apps === next.apps) return;
    lastCountsRef.current = next;
    onCountsRef.current?.(next);
  }, [pages.length, apps.length, pagesLoading, appsLoading]);

  if (!ownerHex) return null;

  if (pagesLoading || appsLoading) {
    return (
      <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
        <p className="text-sm text-gray-400">Loading pages and apps…</p>
      </div>
    );
  }

  const showPages = pages.length > 0;
  const showApps = apps.length > 0;
  if (!showPages && !showApps) return null;

  return (
    <>
      {showPages ? (
        <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Globe
                className="h-6 w-6 text-[var(--color-accent-primary)]"
                aria-hidden
              />
              Pages ({pages.length})
            </h2>
            <Link
              href="/pages"
              className="text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Browse all pages
            </Link>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.slice(0, visiblePages).map((s) => (
              <li key={`${s.siteUrl}-${s.pathsStatusUrl}`}>
                <article className="flex h-full min-h-[10rem] flex-col rounded-xl border border-[#383B42] bg-[#0E1116]/95 p-4 transition hover:border-[var(--color-accent-primary)]/50">
                  <h3 className="line-clamp-2 text-lg font-semibold text-white">
                    {s.title}
                  </h3>
                  {s.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-400">
                      {s.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-gray-500">
                    {s.pathCount} path{s.pathCount === 1 ? "" : "s"}
                    {s.updatedLabel ? ` · ${s.updatedLabel}` : ""}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-[#383B42]/60 pt-3">
                    <a
                      className={cn(
                        buttonVariants({ size: "sm", variant: "default" })
                      )}
                      href={s.siteUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Open site
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <LoadMoreButton
            visibleCount={Math.min(visiblePages, pages.length)}
            totalCount={pages.length}
            pageSize={REPO_LIST_PAGE_SIZE}
            onLoadMore={() => setVisiblePages((n) => n + REPO_LIST_PAGE_SIZE)}
          />
        </div>
      ) : null}

      {showApps ? (
        <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Smartphone
                className="h-6 w-6 text-[var(--color-accent-primary)]"
                aria-hidden
              />
              Apps ({apps.length})
            </h2>
            <Link
              href="/apps"
              className="text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Browse all apps
            </Link>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.slice(0, visibleApps).map((app) => (
              <li key={appDedupKey(app.pubkey, app.appId)}>
                <article className="flex h-full min-h-[10rem] gap-3 rounded-xl border border-[#383B42] bg-[#0E1116]/95 p-4 transition hover:border-[var(--color-accent-primary)]/50">
                  {app.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={app.icon}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl border border-[#383B42]/80 object-cover bg-[#171B21]"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#383B42]/80 bg-[#171B21] text-lg font-bold text-gray-400">
                      {app.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 flex flex-col">
                    <h3 className="truncate text-lg font-semibold text-white">
                      {app.name}
                    </h3>
                    {app.summary ? (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-400">
                        {app.summary}
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      {app.webUrl || app.repository ? (
                        <a
                          className={cn(
                            buttonVariants({
                              size: "sm",
                              variant: "default",
                            })
                          )}
                          href={app.webUrl || app.repository}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Open
                          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <Link
                          className={cn(
                            buttonVariants({
                              size: "sm",
                              variant: "outline",
                            })
                          )}
                          href="/apps"
                        >
                          View in Apps
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <LoadMoreButton
            visibleCount={Math.min(visibleApps, apps.length)}
            totalCount={apps.length}
            pageSize={REPO_LIST_PAGE_SIZE}
            onLoadMore={() => setVisibleApps((n) => n + REPO_LIST_PAGE_SIZE)}
          />
        </div>
      ) : null}
    </>
  );
}
