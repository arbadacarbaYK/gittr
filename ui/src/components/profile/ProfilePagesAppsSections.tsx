"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  SoftwareAppDirectoryCard,
  SoftwareAppProfileFooter,
} from "@/components/apps/SoftwareAppDirectoryCard";
import { GittrPageDirectoryCard } from "@/components/pages/GittrPageDirectoryCard";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { authorPubkeyHexNormalized } from "@/lib/gittr-pages/author-card-label";
import { pageBelongsToOwner } from "@/lib/gittr-pages/pages-owner-match";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import {
  type ParsedSoftwareApp,
  appDedupKey,
  preferOwnerSoftwareApps,
} from "@/lib/nostr/nip82-software";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";

import { Globe, Smartphone } from "lucide-react";
import Link from "next/link";

type ProfilePagesAppsSectionsProps = {
  /** Full 64-char hex pubkey of the profile owner */
  ownerPubkeyHex: string | null | undefined;
  /** Optional: surface counts for the profile stats row */
  onCountsChange?: (counts: { pages: number; apps: number }) => void;
};

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
 * Cards use the same chrome as /pages and /apps.
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

  const profilePubkeys = useMemo(() => {
    const s = new Set<string>();
    if (ownerHex) s.add(ownerHex);
    for (const a of apps) {
      s.add(a.pubkey.toLowerCase());
      for (const p of a.attributedPubkeys) s.add(p.toLowerCase());
    }
    for (const site of pages) {
      const hex = authorPubkeyHexNormalized(site.authorPubkeyHex);
      if (hex) s.add(hex);
    }
    return Array.from(s);
  }, [ownerHex, apps, pages]);
  const metadataMap = useContributorMetadata(profilePubkeys);

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
          const pagesRes = await fetch(
            `/api/gittr-pages/status-sites?author=${encodeURIComponent(
              ownerHex
            )}`
          );
          const pagesData = (await pagesRes.json()) as {
            sites?: GatewayStatusSiteRow[];
            error?: string;
          };
          if (cancelled) return;
          if (!pagesRes.ok)
            throw new Error(pagesData.error || `pages ${pagesRes.status}`);
          setPages(
            (pagesData.sites || []).filter((s) =>
              pageBelongsToOwner(s, ownerHex)
            )
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
          if (!appsRes.ok)
            throw new Error(appsData.error || `apps ${appsRes.status}`);
          setApps(preferOwnerSoftwareApps(appsData.apps || [], ownerHex));
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

  // Stay silent while loading or when empty — only paint sections that have real items.
  // A "Loading pages and apps…" line made the profile look unfinished for everyone.
  const showPages = !pagesLoading && pages.length > 0;
  const showApps = !appsLoading && apps.length > 0;
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
            {pages.slice(0, visiblePages).map((s) => {
              const hex = authorPubkeyHexNormalized(s.authorPubkeyHex);
              return (
                <li key={`${s.siteUrl}-${s.pathsStatusUrl}`}>
                  <GittrPageDirectoryCard
                    site={s}
                    authorMeta={hex ? metadataMap[hex] : undefined}
                  />
                </li>
              );
            })}
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
                <SoftwareAppDirectoryCard
                  app={app}
                  authorMeta={metadataMap[app.pubkey.toLowerCase()]}
                  metadataMap={metadataMap}
                  footer={<SoftwareAppProfileFooter app={app} />}
                />
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
