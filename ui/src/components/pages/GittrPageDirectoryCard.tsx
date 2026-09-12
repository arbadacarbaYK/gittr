"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  DIRECTORY_TILE_ARTICLE_CLASS,
  DirectoryTileFallbackIcon,
} from "@/components/ui/directory-tile-card";
import { TrustBadge } from "@/components/ui/trust-badge";
import {
  authorPubkeyHexNormalized,
  cardAuthorPrimary,
  cardAuthorProfileHref,
  cardAuthorTooltip,
  formatPagesStatCount,
  siteHostname,
  siteKindLabel,
} from "@/lib/gittr-pages/author-card-label";
import { gittrRepoPathForPagesSite } from "@/lib/gittr-pages/pages-repo-path";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import { pickProfileDisplayName } from "@/lib/nostr/kind0-profile-fields";
import type { Metadata } from "@/lib/nostr/useContributorMetadata";
import { cn } from "@/lib/utils";
import { isDisplayableProfilePicture } from "@/lib/utils/entity-resolver";

import { ExternalLink, Globe } from "lucide-react";

export function GittrPageDirectoryCard({
  site,
  authorMeta,
}: {
  site: GatewayStatusSiteRow;
  authorMeta?: Metadata;
}) {
  const authorPrimary = cardAuthorPrimary(site);
  const authorTip = cardAuthorTooltip(site);
  const authorHref = cardAuthorProfileHref(site);
  const authorHex = authorPubkeyHexNormalized(site.authorPubkeyHex);
  const authorLabel = pickProfileDisplayName(authorMeta) || authorPrimary;
  const host = siteHostname(site.siteUrl);
  const kindLbl = siteKindLabel(site.siteKind);
  const repoPath = gittrRepoPathForPagesSite(site);

  return (
    <article className={DIRECTORY_TILE_ARTICLE_CLASS}>
      <div className="shrink-0">
        <DirectoryTileFallbackIcon>
          <Globe className="h-8 w-8 text-gray-600" />
        </DirectoryTileFallbackIcon>
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
          {site.title}
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
                    isDisplayableProfilePicture(authorMeta.picture)
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
        {site.description ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-400">
            {site.description}
          </p>
        ) : null}
        <p
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500"
          title={site.updatedIso || undefined}
        >
          <span>
            {formatPagesStatCount(site.pathCount)} path
            {site.pathCount === 1 ? "" : "s"}
          </span>
          {site.snapshots > 0 ? (
            <span>
              {formatPagesStatCount(site.snapshots)} snapshot
              {site.snapshots === 1 ? "" : "s"}
            </span>
          ) : null}
          <span>
            {formatPagesStatCount(site.hits)} hit
            {site.hits === 1 ? "" : "s"}
          </span>
          {site.updatedLabel ? <span>{site.updatedLabel}</span> : null}
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
            href={site.siteUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open site
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </a>
          {repoPath ? (
            <a
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              href={repoPath}
              rel="noopener noreferrer"
              target="_blank"
            >
              Repo
            </a>
          ) : null}
          <a
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
            href={site.pathsStatusUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Details
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </a>
        </div>
      </div>
    </article>
  );
}
