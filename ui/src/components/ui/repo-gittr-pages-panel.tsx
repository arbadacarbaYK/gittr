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
  /** Optional: refetch from relays first (reload), then Push Page — use when local may be stale. */
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
}) {
  const { ok, warning, title, description, onClick, disabled } = props;
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
        <span className="text-xs font-medium tracking-tight text-zinc-100">
          {title}
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
        <span className="min-w-0 flex-1 leading-tight">gittr Pages</span>
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
            </div>
            <div className="divide-y divide-zinc-800/80 px-1 py-0.5">
              <ChecklistRow
                ok={siteOk}
                title="Site entry"
                description={
                  siteOk
                    ? "Root file present."
                    : "Need index.html (or similar)."
                }
                onClick={
                  onFocusSiteFiles ? () => onFocusSiteFiles() : undefined
                }
              />
              <ChecklistRow
                ok={readmeOk}
                title="README & live URL"
                description={
                  readmeOk ? "OK." : "Pages block or auto-update on push."
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
              />
              <ChecklistRow
                ok={gatewayListsSite === true}
                warning={gatewayListsSite === false}
                title="Directory"
                description={
                  gatewayListsSite === true
                    ? "Listed."
                    : gatewayListsSite === false
                    ? "Not listed yet."
                    : "Checking…"
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
              />
              <ChecklistRow
                ok={pushClean}
                warning={pushNeeded}
                title="Relays"
                description={
                  pushClean
                    ? "Synced."
                    : pagesReadiness.hasUnpushedEdits
                    ? "Unpushed edits."
                    : "Not pushed yet."
                }
              />
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
            <ul className="space-y-1.5">
              <li>
                Files — main panel; refetch only if this copy may lag relays.
              </li>
              <li>README — tap the row above or use Push Page.</li>
              <li>Push — button under this card (tree + README).</li>
              <li>Manifest — Publish or any NIP-5A workflow you like.</li>
            </ul>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800/60 pt-2">
              <a
                className="text-violet-400 underline-offset-2 hover:underline"
                href="https://github.com/nostr-protocol/nips/blob/master/5A.md"
                rel="noopener noreferrer"
                target="_blank"
              >
                NIP-5A
                <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
              </a>
              <Link
                className="text-violet-400 underline-offset-2 hover:underline"
                href="/pages"
              >
                /pages
              </Link>
            </p>
          </div>
        </details>

        {(isOwnerSession && onPublishNamedSiteManifest) || issueDraft ? (
          <div className="space-y-2 rounded-xl border border-amber-900/20 bg-amber-950/[0.07] p-3">
            <SectionLabel>Manifest</SectionLabel>
            <div className="flex flex-col gap-2">
              {issueDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={chainActionsDisabled}
                  className={cn(
                    btnMultiline,
                    "border-violet-800/40 bg-violet-950/25 text-violet-100 hover:bg-violet-900/35"
                  )}
                  onClick={openManifestIssue}
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 font-medium">
                    Click to create manifest
                  </span>
                </Button>
              ) : null}
              {isOwnerSession && onPublishNamedSiteManifest ? (
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
                    {manifestBusy ? "Push Manifest…" : "Push Manifest"}
                  </span>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {canManageReadme ? (
          <div className="space-y-2 rounded-xl border border-violet-800/25 bg-violet-950/[0.08] p-3">
            <SectionLabel>README &amp; page</SectionLabel>
            {isOwnerSession && onAutoReadmeOnPushChange ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-violet-800/30 bg-black/20 px-2.5 py-2 text-[11px] text-zinc-300 transition hover:border-violet-700/40">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 rounded border-violet-600 bg-zinc-900 text-violet-500 focus:ring-violet-500/40"
                  checked={autoReadmeOnPush}
                  onChange={(e) => onAutoReadmeOnPushChange(e.target.checked)}
                  title="Refresh the Pages README block automatically before each push."
                />
                <span className="font-medium text-zinc-100">
                  Auto-update README on push
                </span>
              </label>
            ) : null}
            {isOwnerSession && onReadmeThenPush ? (
              <div className="flex flex-col gap-2">
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
                  <span className="min-w-0 text-left font-medium">
                    {busy ? "Working…" : "Click to create Pagelink in Readme"}
                  </span>
                </Button>
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
                    Push Page
                  </span>
                </Button>
                {canChainNostrRefetch && onRefetchThenReadmeThenPush ? (
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
                      Refetch → Push Page
                    </span>
                  </Button>
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
                <span className="min-w-0 text-left font-medium">
                  {busy ? "Working…" : "Click to create Pagelink in Readme"}
                </span>
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}
