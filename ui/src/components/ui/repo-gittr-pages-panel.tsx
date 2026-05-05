"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  /** Optional: refetch from relays first (reload), then Re/push Page — use when local may be stale. */
  onRefetchThenReadmeThenPush?: () => void;
  /** Owner: show checklist (site file, readme, push state) vs manual manifest outside gittr. */
  pagesReadiness?: GittrPagesReadiness | null;
  /** Scroll/focus main repo file area (e.g. add index.html). */
  onFocusSiteFiles?: () => void;
  /** Owner: optional custom Pages `d` tag (normalized); empty = use repo slug. */
  pagesSiteSlug?: string | null;
  onCommitPagesSiteSlug?: (
    raw: string | null
  ) => Promise<
    { ok: true } | { ok: false; message: string; suggestions?: string[] }
  >;
};

const btnMultiline = cn(
  "!h-auto min-h-9 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left text-xs font-normal leading-snug"
);

function ChecklistRow(props: {
  ok: boolean;
  warning?: boolean;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const { ok, warning, title, onClick, disabled } = props;
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
      <span className="min-w-0 flex-1 text-xs font-medium tracking-tight text-zinc-100">
        {title}
      </span>
    </>
  );

  const rowClass = cn(
    "flex w-full gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
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
  pagesSiteSlug = null,
  onCommitPagesSiteSlug,
}: RepoGittrPagesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const blossomUploadBase = rawGittrPagesBlossomEnvOrigin();
  const blossomStaticSiteWarning =
    Boolean(onPublishNamedSiteManifest) &&
    isMediaOnlyNostrBuildBlossom(blossomUploadBase);
  const [manifestBusy, setManifestBusy] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugSuggestions, setSlugSuggestions] = useState<string[]>([]);
  const [slugBusy, setSlugBusy] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  useEffect(() => {
    setSlugDraft(pagesSiteSlug ?? "");
  }, [pagesSiteSlug]);

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
  /** Manifest should match what is already on relays — require a site tree and a clean push state. */
  const manifestPublishBlocked = Boolean(
    pagesReadiness && (!siteOk || pagesReadiness.hasUnpushedEdits)
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
    if (!hasGittrPagesEntryFile(pagesReadiness?.files)) {
      alert(
        "Cannot create/push manifest yet: this repo has no static page entry file in root (for example index.html). Add one first."
      );
      return;
    }
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
            <div className="divide-y divide-zinc-800/80 px-1 py-0.5">
              <ChecklistRow
                ok={siteOk}
                title="Site entry"
                onClick={
                  onFocusSiteFiles ? () => onFocusSiteFiles() : undefined
                }
              />
              <ChecklistRow
                ok={readmeOk}
                title="README & live URL"
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
                onClick={
                  issueDraft &&
                  gatewayListsSite !== true &&
                  !chainActionsDisabled
                    ? openManifestIssue
                    : onPublishNamedSiteManifest &&
                      gatewayListsSite === false &&
                      !chainActionsDisabled &&
                      !manifestPublishBlocked
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
                disabled={
                  manifestBusy ||
                  chainActionsDisabled ||
                  (Boolean(
                    onPublishNamedSiteManifest && gatewayListsSite === false
                  ) &&
                    manifestPublishBlocked)
                }
              />
              <ChecklistRow
                ok={pushClean}
                warning={pushNeeded}
                title="Relays"
              />
            </div>
          </div>
        ) : null}

        {isOwnerSession && pagesReadiness && onCommitPagesSiteSlug ? (
          <div className="space-y-2 rounded-xl border border-violet-800/25 bg-violet-950/[0.08] p-3">
            <SectionLabel>Site name</SectionLabel>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Optional short display name for your page listing; it does not
              change the real live URL.
            </p>
            {pagesReadiness?.namedUrl ? (
              <div className="flex items-center gap-1.5 text-[10px]">
                <a
                  href={pagesReadiness.namedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-violet-300 underline-offset-2 hover:underline"
                  title={pagesReadiness.namedUrl}
                >
                  {pagesReadiness.namedUrl}
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(
                          pagesReadiness.namedUrl
                        );
                        setUrlCopied(true);
                        setTimeout(() => setUrlCopied(false), 1200);
                      } catch {
                        window.prompt(
                          "Copy live URL:",
                          pagesReadiness.namedUrl
                        );
                      }
                    })();
                  }}
                >
                  {urlCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : null}
            <Input
              value={slugDraft}
              onChange={(e) => {
                setSlugDraft(e.target.value);
                setSlugError(null);
              }}
              placeholder="(repo slug)"
              disabled={slugBusy || chainActionsDisabled}
              className="h-9 border-violet-800/40 bg-black/30 text-xs text-zinc-100"
              maxLength={32}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {slugError ? (
              <p className="text-[10px] text-rose-300/95">{slugError}</p>
            ) : null}
            {slugSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {slugSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded border border-violet-800/40 bg-violet-950/40 px-2 py-0.5 text-[10px] text-violet-200 hover:bg-violet-900/50"
                    onClick={() => {
                      setSlugDraft(s);
                      setSlugError(null);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={slugBusy || chainActionsDisabled}
                className="border-violet-600/40 text-xs text-violet-50"
                onClick={() => {
                  void (async () => {
                    setSlugBusy(true);
                    setSlugError(null);
                    setSlugSuggestions([]);
                    try {
                      const res = await onCommitPagesSiteSlug(
                        slugDraft.trim() === "" ? null : slugDraft
                      );
                      if (!res.ok) {
                        setSlugError(res.message);
                        setSlugSuggestions(res.suggestions ?? []);
                      }
                    } finally {
                      setSlugBusy(false);
                    }
                  })();
                }}
              >
                {slugBusy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={
                  slugBusy ||
                  chainActionsDisabled ||
                  (!(pagesSiteSlug ?? "").trim() && !slugDraft.trim())
                }
                className="text-xs text-zinc-400"
                onClick={() => {
                  setSlugDraft("");
                  void (async () => {
                    setSlugBusy(true);
                    setSlugError(null);
                    setSlugSuggestions([]);
                    try {
                      const res = await onCommitPagesSiteSlug(null);
                      if (!res.ok) {
                        setSlugError(res.message);
                        setSlugSuggestions(res.suggestions ?? []);
                      }
                    } finally {
                      setSlugBusy(false);
                    }
                  })();
                }}
              >
                Clear custom
              </Button>
            </div>
          </div>
        ) : null}

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
                  disabled={
                    manifestBusy ||
                    chainActionsDisabled ||
                    manifestPublishBlocked
                  }
                  title={
                    manifestPublishBlocked
                      ? "Add a site entry file and Push to Nostr first (no unpushed edits), then publish the manifest."
                      : undefined
                  }
                  className={cn(
                    btnMultiline,
                    "border-amber-700/45 bg-amber-950/20 text-amber-50 hover:bg-amber-950/35"
                  )}
                  onClick={() => {
                    void (async () => {
                      if (!hasGittrPagesEntryFile(pagesReadiness?.files)) {
                        alert(
                          "Cannot push manifest yet: this repo has no static page entry file in root (for example index.html). Add one first."
                        );
                        return;
                      }
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
                    Re/push Page
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
                      Refetch → Re/push Page
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
