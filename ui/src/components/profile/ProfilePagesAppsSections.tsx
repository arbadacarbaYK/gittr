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

import { ExternalLink, Globe, Loader2, Smartphone } from "lucide-react";
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

/**
 * Profile sections for this person's Nostr Pages (gateway) and Apps (NIP-82).
 * Mirrors the stacked Repositories block style — not tabs.
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
      onCountsRef.current?.({ pages: 0, apps: 0 });
      return;
    }

    let cancelled = false;
    setPagesLoading(true);
    setAppsLoading(true);

    fetch("/api/gittr-pages/status-sites")
      .then(async (res) => {
        const data = (await res.json()) as {
          sites?: GatewayStatusSiteRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `pages ${res.status}`);
        const mine = (data.sites || []).filter((s) =>
          pageBelongsToOwner(s, ownerHex)
        );
        if (!cancelled) setPages(mine);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });

    fetch("/api/nostr/software-catalog")
      .then(async (res) => {
        const data = (await res.json()) as {
          apps?: ParsedSoftwareApp[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `apps ${res.status}`);
        const mine = (data.apps || []).filter((a) =>
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
        if (!cancelled) setApps(unique);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      })
      .finally(() => {
        if (!cancelled) setAppsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerHex]);

  useEffect(() => {
    onCountsRef.current?.({ pages: pages.length, apps: apps.length });
  }, [pages.length, apps.length]);

  if (!ownerHex) return null;

  const showPages = pagesLoading || pages.length > 0;
  const showApps = appsLoading || apps.length > 0;
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
              Pages {pagesLoading ? "" : `(${pages.length})`}
            </h2>
            <Link
              href="/pages"
              className="text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Browse all pages
            </Link>
          </div>
          {pagesLoading && pages.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pages…
            </div>
          ) : (
            <>
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
                onLoadMore={() =>
                  setVisiblePages((n) => n + REPO_LIST_PAGE_SIZE)
                }
              />
            </>
          )}
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
              Apps {appsLoading ? "" : `(${apps.length})`}
            </h2>
            <Link
              href="/apps"
              className="text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Browse all apps
            </Link>
          </div>
          {appsLoading && apps.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading apps…
            </div>
          ) : (
            <>
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
                onLoadMore={() =>
                  setVisibleApps((n) => n + REPO_LIST_PAGE_SIZE)
                }
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
