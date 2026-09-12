"use client";

import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { DIRECTORY_TILE_ARTICLE_CLASS } from "@/components/ui/directory-tile-card";
import { TrustBadge } from "@/components/ui/trust-badge";
import { pickProfileDisplayName } from "@/lib/nostr/kind0-profile-fields";
import { repositoryUrlToReleasesHref } from "@/lib/nostr/nip82-repository-links";
import {
  type ParsedSoftwareApp,
  platformHintToLabel,
} from "@/lib/nostr/nip82-software";
import type { Metadata } from "@/lib/nostr/useContributorMetadata";
import { cn } from "@/lib/utils";
import {
  isDisplayableProfilePicture,
  ownerProfileHref,
} from "@/lib/utils/entity-resolver";

import { ExternalLink, Package } from "lucide-react";
import { nip19 } from "nostr-tools";

function shortNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex).slice(0, 16) + "…";
  } catch {
    return hex.slice(0, 12) + "…";
  }
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

export function topicLabelsForApp(app: ParsedSoftwareApp): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (x: string) => {
    const t = x.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  for (const t of app.topics) push(t);
  for (const f of app.platformHints) {
    const lbl = platformHintToLabel(f);
    if (lbl) push(lbl);
  }
  return out;
}

export function SoftwareAppDirectoryCard({
  app,
  authorMeta,
  metadataMap,
  labels,
  gh,
  footer,
}: {
  app: ParsedSoftwareApp;
  authorMeta?: Metadata;
  metadataMap?: Record<string, Metadata | undefined>;
  labels?: string[];
  gh?: { stars: number; forks: number };
  footer: ReactNode;
}) {
  const npubShort = shortNpub(app.pubkey);
  const authorLabel = pickProfileDisplayName(authorMeta) || npubShort;
  const profileHref = ownerProfileHref(app.pubkey);
  const pills = labels && labels.length > 0 ? labels : topicLabelsForApp(app);
  const metaFor = (pk: string) =>
    metadataMap?.[pk.toLowerCase()] ?? metadataMap?.[pk];

  return (
    <article className={DIRECTORY_TILE_ARTICLE_CLASS}>
      <div className="shrink-0">
        {app.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-16 w-16 rounded-xl border border-[#383B42]/80 bg-[#171B21] object-cover"
            height={64}
            src={app.icon}
            width={64}
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              const sib = el.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="h-16 w-16 items-center justify-center rounded-xl border border-[#383B42]/80 bg-[#171B21]"
          style={{
            display: app.icon ? "none" : "flex",
          }}
        >
          <Package className="h-8 w-8 text-gray-600" />
        </div>
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-white">
          {app.name}
        </h2>
        <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
          {app.appId}
        </p>
        <div className="mt-1 flex min-w-0 items-start gap-2">
          {profileHref ? (
            <a
              className="flex min-w-0 flex-1 items-start gap-2 rounded-md outline-offset-2 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-primary)]"
              href={profileHref}
              rel="noopener noreferrer"
              target="_blank"
              title={`${authorLabel} · ${npubForTitle(app.pubkey)}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[#383B42]/80 object-cover bg-[#22262C]"
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
                <div className="mt-1">
                  <TrustBadge targetPubkey={app.pubkey} />
                </div>
              </div>
            </a>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[#383B42]/80 object-cover bg-[#22262C]"
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
        {app.attributedPubkeys.length > 0 ? (
          <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
            <span className="text-gray-600">With </span>
            {app.attributedPubkeys.slice(0, 3).map((pk, i) => (
              <span key={pk}>
                {i > 0 ? ", " : ""}
                {pickProfileDisplayName(metaFor(pk)) || shortNpub(pk)}
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
                {gh.forks > 0 ? ` · ${formatStarCount(gh.forks)} forks` : ""}
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
        {pills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pills.map((lb) => (
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
          {footer}
        </div>
      </div>
    </article>
  );
}

/** Default actions when the directory is not resolving APK assets (profile). */
export function SoftwareAppProfileFooter({ app }: { app: ParsedSoftwareApp }) {
  return (
    <>
      {app.gittrRepoPath ? (
        <a
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          href={app.gittrRepoPath}
          rel="noopener noreferrer"
          target="_blank"
        >
          Repo
        </a>
      ) : null}
      {app.repository ? (
        <a
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
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
            buttonVariants({ size: "sm", variant: "default" }),
            "shadow-sm"
          )}
          href={app.webUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
        </a>
      ) : !app.repository && !app.gittrRepoPath ? (
        <a
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          href="/apps"
        >
          View in Apps
        </a>
      ) : null}
    </>
  );
}
