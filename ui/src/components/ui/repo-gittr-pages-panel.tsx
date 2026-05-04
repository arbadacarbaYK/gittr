"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  isMediaOnlyNostrBuildBlossom,
  rawGittrPagesBlossomEnvOrigin,
} from "@/lib/gittr-pages/gittr-pages-blossom-origin";
import {
  GITTR_PAGES_ISSUE_PREFILL_KEY,
  type GittrPagesIssueDraftInput,
  buildGittrPagesManifestIssueDraft,
} from "@/lib/gittr-pages/gittr-pages-issue-draft";
import { hasGittrPagesEntryFile } from "@/lib/gittr-pages/pages-preconditions";
import { validateReadmeGittrPagesBlock } from "@/lib/gittr-pages/readme-section";
import { cn } from "@/lib/utils";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  Globe,
  RefreshCw,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Live sidebar status for “what gittr can help with” vs fully manual steps outside gittr. */
export type GittrPagesReadiness = {
  files?: Array<{ path?: string }>;
  readme: string;
  autoReadmeOnPush: boolean;
  hasUnpushedEdits: boolean;
  hasEverPushedToNostr: boolean;
  namedUrl: string;
  dTag: string;
};

type RepoGittrPagesPanelProps = {
  canManageReadme: boolean;
  isOwnerSession: boolean;
  autoReadmeOnPush?: boolean;
  onAutoReadmeOnPushChange?: (value: boolean) => void;
  onAppendReadme: () => void | Promise<void>;
  issueDraft?: GittrPagesIssueDraftInput | null;
  /** Owner: upload static files to Blossom (NIP-07) then publish kind 35128 to relays. */
  onPublishNamedSiteManifest?: () => void | Promise<void>;
  /** Disables chained README / refetch actions while push or refetch is in flight. */
  chainActionsDisabled?: boolean;
  /** Show “refetch Nostr → README → push” when the repo sidebar exposes Nostr refetch. */
  canChainNostrRefetch?: boolean;
  /** Update README gittr Pages block then trigger Push to Nostr (same session). */
  onReadmeThenPush?: () => void | Promise<void>;
  /** Optional: refetch from relays first (reload), then README + Push — use when local may be stale. */
  onRefetchThenReadmeThenPush?: () => void;
  /** Owner: show checklist (site file, readme, push state) vs manual manifest outside gittr. */
  pagesReadiness?: GittrPagesReadiness | null;
  /** Scroll/focus main repo file area (e.g. add index.html). */
  onFocusSiteFiles?: () => void;
};

const btnMultiline = cn(
  "!h-auto min-h-9 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left text-xs font-normal leading-snug"
);

function ChecklistRow(props: {
  ok: boolean;
  warning?: boolean;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
  actionHint?: string;
}) {
  const { ok, warning, title, description, onClick, disabled, actionHint } =
    props;
  const interactive = Boolean(onClick) && !disabled;
  const Icon = ok ? CheckCircle2 : Circle;
  const iconClass = ok
    ? "text-emerald-400/95"
    : warning
    ? "text-amber-500/85"
    : "text-zinc-500";

  const body = (
    <>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium tracking-tight text-zinc-100">
            {title}
          </span>
          {actionHint && interactive ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-300/75">
              <ChevronRight className="h-3 w-3 opacity-70" aria-hidden />
              {actionHint}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
          {description}
        </span>
      </span>
    </>
  );

  const rowClass = cn(
    "flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
    interactive &&
      "cursor-pointer text-zinc-200 hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500/50",
    !interactive && "cursor-default"
  );

  if (interactive) {
    return (
      <button type="button" className={rowClass} onClick={onClick}>
        {body}
      </button>
    );
  }

  return <div className={rowClass}>{body}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  );
}

export function RepoGittrPagesPanel({
  canManageReadme,
  isOwnerSession,
  autoReadmeOnPush = false,
  onAutoReadmeOnPushChange,
  onAppendReadme,
  issueDraft,
  onPublishNamedSiteManifest,
  chainActionsDisabled = false,
  canChainNostrRefetch = false,
  onReadmeThenPush,
  onRefetchThenReadmeThenPush,
  pagesReadiness = null,
  onFocusSiteFiles,
}: RepoGittrPagesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const blossomUploadBase = rawGittrPagesBlossomEnvOrigin();
  const blossomStaticSiteWarning =
    Boolean(onPublishNamedSiteManifest) &&
    isMediaOnlyNostrBuildBlossom(blossomUploadBase);
  const [manifestBusy, setManifestBusy] = useState(false);
  /** Keep “Steps & links” closed by default; user opens when needed. */
  const [stepsLinksOpen, setStepsLinksOpen] = useState(false);

  const readmeOk = Boolean(
    pagesReadiness &&
      (pagesReadiness.autoReadmeOnPush ||
        validateReadmeGittrPagesBlock(
          pagesReadiness.readme,
          pagesReadiness.namedUrl
        ).ok)
  );
  const siteOk = Boolean(
    pagesReadiness && hasGittrPagesEntryFile(pagesReadiness.files)
  );
  const pushClean = Boolean(
    pagesReadiness &&
      pagesReadiness.hasEverPushedToNostr &&
      !pagesReadiness.hasUnpushedEdits
  );
  const pushNeeded = Boolean(
    pagesReadiness &&
      (pagesReadiness.hasUnpushedEdits || !pagesReadiness.hasEverPushedToNostr)
  );
  const gittrStepsReady = Boolean(
    pagesReadiness && readmeOk && siteOk && !pagesReadiness.hasUnpushedEdits
  );

  const [gatewayListsSite, setGatewayListsSite] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    if (!pagesReadiness?.namedUrl) {
      setGatewayListsSite(null);
      return;
    }
    let cancelled = false;
    const want = pagesReadiness.namedUrl.replace(/\/$/, "").toLowerCase();
    const dTag = pagesReadiness.dTag?.toLowerCase() || "";
    (async () => {
      try {
        const res = await fetch("/api/gittr-pages/status-sites");
        if (!res.ok) {
          if (!cancelled) setGatewayListsSite(null);
          return;
        }
        const data = (await res.json()) as {
          sites?: Array<{ siteUrl?: string }>;
        };
        const sites = Array.isArray(data.sites) ? data.sites : [];
        const hit = sites.some((s) => {
          const u = (s.siteUrl || "").replace(/\/$/, "").toLowerCase();
          return (
            u === want ||
            (dTag &&
              (u.includes(dTag) || u.endsWith(`${dTag}.pages.gittr.space`)))
          );
        });
        if (!cancelled) setGatewayListsSite(hit);
      } catch {
        if (!cancelled) setGatewayListsSite(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pagesReadiness?.namedUrl, pagesReadiness?.dTag]);

  const openManifestIssue = () => {
    if (!issueDraft) return;
    const { title, body } = buildGittrPagesManifestIssueDraft(issueDraft);
    try {
      sessionStorage.setItem(
        GITTR_PAGES_ISSUE_PREFILL_KEY,
        JSON.stringify({
          entity: issueDraft.entity,
          repo: issueDraft.repo,
          title,
          body,
        })
      );
    } catch {
      alert("Could not store draft (storage blocked?).");
      return;
    }
    const e = encodeURIComponent(issueDraft.entity);
    const r = encodeURIComponent(issueDraft.repo);
    router.push(`/${e}/${r}/issues/new`);
  };

  return (
    <details className="group mt-3 overflow-hidden rounded-xl border border-violet-900/30 bg-gradient-to-b from-violet-950/20 to-zinc-950/40 open:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-3 text-sm font-semibold tracking-tight text-white [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/20">
          <Globe className="h-4 w-4 text-violet-300" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-tight">gittr Pages</span>
          <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
            Static site, README, manifest
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition duration-200 group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-violet-900/25 px-3 pb-3.5 pt-3">
        {blossomStaticSiteWarning ? (
          <p className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2.5 text-[10px] leading-relaxed text-amber-100/95">
            <strong className="text-amber-200">Blossom URL:</strong>{" "}
            <code className="break-all text-amber-50/90">
              {blossomUploadBase}
            </code>{" "}
            is media-only (no site <code className="text-amber-50/90">.js</code>{" "}
            etc.). Set{" "}
            <code className="text-amber-50/90">
              NEXT_PUBLIC_BLOSSOM_URL=https://blossom.band
            </code>{" "}
            (or{" "}
            <code className="text-amber-50/90">
              NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL
            </code>
            ), then <code className="text-amber-50/90">yarn build</code> +
            restart <code className="text-amber-50/90">gittr-frontend</code>.{" "}
            <Link
              className="font-medium text-amber-200 underline underline-offset-2 hover:text-amber-50"
              href="/help"
            >
              Help
            </Link>{" "}
            · <strong className="text-amber-200">SETUP_INSTRUCTIONS.md</strong>
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-zinc-500">
          <strong className="font-medium text-zinc-400">Push</strong> sends tree
          + README.{" "}
          <strong className="font-medium text-zinc-400">Publish</strong> sends
          the NIP-5A manifest (kind <code className="text-zinc-500">35128</code>
          ) + blobs so the directory can list your live URL.
        </p>

        {pagesReadiness && isOwnerSession ? (
          <div
            className={cn(
              "overflow-hidden rounded-xl border",
              gittrStepsReady
                ? "border-emerald-800/35 bg-emerald-950/[0.12]"
                : "border-violet-800/30 bg-black/20"
            )}
          >
            <div
              className={cn(
                "border-b px-3 py-2",
                gittrStepsReady
                  ? "border-emerald-800/25 bg-emerald-950/20"
                  : "border-violet-800/20 bg-violet-950/15"
              )}
            >
              <p className="text-[11px] font-medium text-zinc-200">Readiness</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                Tap a row to jump to the fix. Push below unlocks when site +
                README are satisfied.
              </p>
            </div>
            <div className="divide-y divide-zinc-800/80 px-1 py-0.5">
              <ChecklistRow
                ok={siteOk}
                title="Site entry"
                description={
                  siteOk
                    ? "index.html (or equivalent) is in the tree."
                    : "Add index.html, index.md, or 404.html at the site root."
                }
                onClick={
                  onFocusSiteFiles ? () => onFocusSiteFiles() : undefined
                }
                actionHint={onFocusSiteFiles ? "files" : undefined}
              />
              <ChecklistRow
                ok={readmeOk}
                title="README & live URL"
                description={
                  readmeOk
                    ? "Fenced gittr Pages block or auto-update on push."
                    : "Insert the Pages block or enable auto-update on push."
                }
                onClick={
                  canManageReadme
                    ? () => {
                        void (async () => {
                          setBusy(true);
                          try {
                            await onAppendReadme();
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }
                    : undefined
                }
                disabled={busy || chainActionsDisabled}
                actionHint={
                  canManageReadme && isOwnerSession ? "sync block" : undefined
                }
              />
              <ChecklistRow
                ok={gatewayListsSite === true}
                warning={gatewayListsSite === false}
                title="Directory listing"
                description={
                  gatewayListsSite === true
                    ? "Gateway knows this named URL."
                    : gatewayListsSite === false
                    ? "Publish manifest + blobs, or open a tracking issue."
                    : "Checking gateway…"
                }
                onClick={
                  issueDraft &&
                  gatewayListsSite !== true &&
                  !chainActionsDisabled
                    ? openManifestIssue
                    : onPublishNamedSiteManifest &&
                      gatewayListsSite === false &&
                      !chainActionsDisabled
                    ? () => {
                        void (async () => {
                          setManifestBusy(true);
                          try {
                            await onPublishNamedSiteManifest();
                          } finally {
                            setManifestBusy(false);
                          }
                        })();
                      }
                    : undefined
                }
                disabled={manifestBusy || chainActionsDisabled}
                actionHint={
                  issueDraft && gatewayListsSite !== true
                    ? "issue"
                    : onPublishNamedSiteManifest && gatewayListsSite === false
                    ? "publish"
                    : undefined
                }
              />
              <ChecklistRow
                ok={pushClean}
                warning={pushNeeded}
                title="Relays"
                description={
                  pushClean
                    ? "Local state matches your last push."
                    : pagesReadiness.hasUnpushedEdits
                    ? "Edits not on relays yet — push when ready."
                    : "Nothing published yet — push after the rows above pass."
                }
              />
            </div>
            <div
              className={cn(
                "border-t px-3 py-2 text-[10px] leading-relaxed",
                gittrStepsReady
                  ? "border-emerald-800/25 text-emerald-100/90"
                  : "border-violet-800/20 text-zinc-500"
              )}
            >
              {gittrStepsReady ? (
                <>
                  Site and README are in shape — use{" "}
                  <strong className="text-white">Push to Nostr</strong> if you
                  still have changes, then{" "}
                  <strong className="text-white">Publish</strong> for the
                  gateway.
                </>
              ) : (
                <>
                  <strong className="text-zinc-400">Push</strong> stays
                  soft-locked until{" "}
                  <strong className="text-zinc-400">Site entry</strong> and{" "}
                  <strong className="text-zinc-400">README & live URL</strong>{" "}
                  are done.
                </>
              )}
            </div>
          </div>
        ) : null}

        <details
          className="group/sub overflow-hidden rounded-lg border border-violet-900/20 bg-zinc-950/30"
          open={stepsLinksOpen}
          onToggle={(e) => setStepsLinksOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[11px] font-medium text-violet-200/90 hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-zinc-500 transition duration-200",
                stepsLinksOpen && "rotate-180"
              )}
            />
            Steps &amp; links
          </summary>
          <div className="border-t border-violet-900/15 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500">
            <ol className="list-decimal space-y-1.5 pl-3 marker:text-zinc-600">
              <li>
                Files — main panel; refetch only if this copy may lag relays.
              </li>
              <li>
                README — tap the row above or use{" "}
                <strong className="text-zinc-400">README + Push</strong>.
              </li>
              <li>Push — button under this card (tree + README).</li>
              <li>
                Manifest — <strong className="text-zinc-400">Publish</strong> or
                any NIP-5A workflow you like.
              </li>
            </ol>
            <ul className="mt-2 space-y-1 border-t border-zinc-800/60 pt-2">
              <li>
                <a
                  className="text-violet-400 underline-offset-2 hover:underline"
                  href="https://github.com/nostr-protocol/nips/blob/master/5A.md"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  NIP-5A
                  <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
                </a>
              </li>
              <li>
                <Link
                  className="text-violet-400 underline-offset-2 hover:underline"
                  href="/pages"
                >
                  /pages
                </Link>
              </li>
            </ul>
          </div>
        </details>

        {(isOwnerSession && onPublishNamedSiteManifest) || issueDraft ? (
          <div className="space-y-2 rounded-xl border border-amber-900/20 bg-amber-950/[0.07] p-3">
            <SectionLabel>Manifest &amp; directory</SectionLabel>
            {isOwnerSession && onPublishNamedSiteManifest ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={manifestBusy || chainActionsDisabled}
                  className={cn(
                    btnMultiline,
                    "border-amber-700/45 bg-amber-950/20 text-amber-50 hover:bg-amber-950/35"
                  )}
                  onClick={() => {
                    void (async () => {
                      setManifestBusy(true);
                      try {
                        await onPublishNamedSiteManifest();
                      } finally {
                        setManifestBusy(false);
                      }
                    })();
                  }}
                >
                  <Upload className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 text-left font-medium">
                    {manifestBusy
                      ? "Publishing…"
                      : "Publish manifest (Blossom + 35128)"}
                  </span>
                </Button>
                <p className="text-[10px] leading-snug text-zinc-500">
                  Uses{" "}
                  <code className="text-zinc-500">NEXT_PUBLIC_BLOSSOM_URL</code>{" "}
                  via proxy. Batched signing when the extension allows; keep the
                  site lean for large trees.
                </p>
              </>
            ) : null}
            {issueDraft ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(
                  btnMultiline,
                  "border-violet-800/40 bg-violet-950/25 text-violet-100 hover:bg-violet-900/35"
                )}
                onClick={openManifestIssue}
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">New issue (prefilled checklist)</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        {canManageReadme ? (
          <div className="space-y-2.5 rounded-xl border border-violet-800/25 bg-violet-950/[0.08] p-3">
            <SectionLabel>README &amp; push</SectionLabel>
            {isOwnerSession && onAutoReadmeOnPushChange ? (
              <label className="flex cursor-pointer gap-2.5 rounded-lg border border-violet-800/30 bg-black/20 p-2.5 text-[11px] leading-snug text-zinc-300 transition hover:border-violet-700/40">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-violet-600 bg-zinc-900 text-violet-500 focus:ring-violet-500/40"
                  checked={autoReadmeOnPush}
                  onChange={(e) => onAutoReadmeOnPushChange(e.target.checked)}
                  title="If off, Push requires a valid fenced README block with this repo’s live URL."
                />
                <span className="min-w-0">
                  <span className="font-medium text-zinc-100">
                    Auto-update README block on push
                  </span>
                  <span className="mt-1 block text-[10px] font-normal leading-relaxed text-zinc-500">
                    Refreshes the fenced Pages section before each push. Off =
                    you maintain the block (or push is blocked until it
                    matches).
                  </span>
                </span>
              </label>
            ) : null}
            {isOwnerSession && onReadmeThenPush ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || chainActionsDisabled}
                  className={cn(
                    btnMultiline,
                    "border-emerald-800/45 text-emerald-50 hover:bg-emerald-950/30"
                  )}
                  onClick={() => {
                    void onReadmeThenPush();
                  }}
                >
                  <Upload className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 text-left font-medium">
                    README + Push to Nostr
                  </span>
                </Button>
                <p className="text-[10px] leading-snug text-zinc-500">
                  One flow: Pages block, then the same signatures as the main
                  push button.
                </p>
                {canChainNostrRefetch && onRefetchThenReadmeThenPush ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || chainActionsDisabled}
                      className={cn(
                        btnMultiline,
                        "border-sky-800/45 text-sky-50 hover:bg-sky-950/25"
                      )}
                      onClick={() => onRefetchThenReadmeThenPush()}
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 text-left font-medium">
                        Refetch → README + Push
                      </span>
                    </Button>
                    <p className="text-[10px] leading-snug text-zinc-500">
                      Reload from relays first, then chain on next load.
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || chainActionsDisabled}
                className={cn(
                  btnMultiline,
                  "border-violet-600/40 text-violet-50 hover:bg-violet-950/35"
                )}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onAppendReadme();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 text-left">
                  {busy ? "Copying…" : "Copy README snippet"}
                </span>
              </Button>
            )}
            {isOwnerSession ? (
              <p className="text-[10px] text-zinc-600">
                {onReadmeThenPush ? (
                  <>
                    Manifest is separate: Blossom + kind{" "}
                    <code className="text-zinc-500">35128</code>.
                  </>
                ) : (
                  <>Ask the owner to push so the README reaches relays.</>
                )}
              </p>
            ) : (
              <p className="text-[10px] text-zinc-600">
                Paste where you can edit; owner pushes to relays.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}
