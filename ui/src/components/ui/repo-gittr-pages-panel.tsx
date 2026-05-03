"use client";

import { Button } from "@/components/ui/button";
import {
  GITTR_PAGES_ISSUE_PREFILL_KEY,
  buildGittrPagesManifestIssueDraft,
  type GittrPagesIssueDraftInput,
} from "@/lib/gittr-pages/gittr-pages-issue-draft";

import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe,
  RefreshCw,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

type RepoGittrPagesPanelProps = {
  canManageReadme: boolean;
  isOwnerSession: boolean;
  autoReadmeOnPush?: boolean;
  onAutoReadmeOnPushChange?: (value: boolean) => void;
  onAppendReadme: () => void | Promise<void>;
  issueDraft?: GittrPagesIssueDraftInput | null;
  /** Disables chained README / refetch actions while push or refetch is in flight. */
  chainActionsDisabled?: boolean;
  /** Show “refetch Nostr → README → push” when the repo sidebar exposes Nostr refetch. */
  canChainNostrRefetch?: boolean;
  /** Update README gittr Pages block then trigger Push to Nostr (same session). */
  onReadmeThenPush?: () => void | Promise<void>;
  /** Optional: refetch from relays first (reload), then README + Push — use when local may be stale. */
  onRefetchThenReadmeThenPush?: () => void;
};

/** Sidebar buttons: top-align so multi-line labels never sit on the next control. */
const btnMultiline = cn(
  "!h-auto min-h-9 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left text-xs font-normal leading-snug"
);

export function RepoGittrPagesPanel({
  canManageReadme,
  isOwnerSession,
  autoReadmeOnPush = false,
  onAutoReadmeOnPushChange,
  onAppendReadme,
  issueDraft,
  chainActionsDisabled = false,
  canChainNostrRefetch = false,
  onReadmeThenPush,
  onRefetchThenReadmeThenPush,
}: RepoGittrPagesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <details className="group mt-3 rounded-lg border border-violet-900/35 bg-violet-950/15 open:bg-violet-950/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
        <Globe className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
        gittr Pages
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180" />
      </summary>

      <div className="flow-root space-y-3 border-t border-violet-900/25 px-3 pb-3 pt-2">
        <p className="text-[11px] leading-snug text-zinc-400">
          Live URL above after NIP-5A manifest on relays. README here only adds
          the link in the readme — not the manifest. After{" "}
          <strong className="text-zinc-300">Push to Nostr</strong> from this
          tab, gittr already stores your event IDs locally: you can go straight
          to <strong className="text-zinc-300">README + Push</strong> for the
          next readme change — no need to wait for gossip on relays for this
          browser. Refetch is for when you want relays as the read source
          (stale copy, edits on another device, or sanity-check).
        </p>

        <details className="group/sub rounded-md border border-violet-900/20 bg-violet-950/10">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3 w-3 shrink-0 transition group-open/sub:rotate-180" />
            Steps &amp; links
          </summary>
          <div className="space-y-2 border-t border-violet-900/15 px-2 py-2 text-[10px] leading-relaxed text-zinc-500">
            <ol className="list-decimal space-y-1.5 pl-3 marker:text-zinc-600">
              <li>
                Site files in this repo — edit here;{" "}
                <strong className="text-zinc-400">Refetch from Nostr</strong> only
                if this copy might be behind relays (optional after your own push
                in this tab).
              </li>
              <li>
                README Pages block —{" "}
                <strong className="text-zinc-400">README + Push</strong>, or the
                separate README button / “update on push” checkbox then Push.
              </li>
              <li>
                <strong className="text-zinc-400">Push to Nostr</strong> — repo +
                readme metadata (included in the shortcut above).
              </li>
              <li>
                <strong className="text-zinc-400">35128</strong> manifest + blobs
                — still in your NIP-5A / nsite tool, not this UI.
              </li>
            </ol>
            <p className="text-zinc-600">
              <strong className="text-zinc-500">Default path:</strong> fix files →{" "}
              <strong className="text-zinc-400">README + Push</strong> (same session;
              push already saved event IDs here).{" "}
              <strong className="text-zinc-500">Optional chain:</strong> refetch
              first only when you need relays as read truth, then README + Push.{" "}
              <strong className="text-zinc-500">You still run:</strong> Blossom /
              blob upload + <code className="text-zinc-400">35128</code> with your
              signer (gateway reads relays).
            </p>
            <ul className="space-y-1">
              <li>
                <a
                  className="text-violet-400 underline-offset-2 hover:underline"
                  href="https://github.com/nostr-protocol/nips/blob/master/5A.md"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  NIP-5A spec
                  <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
                </a>
              </li>
              <li>
                <Link
                  className="text-violet-400 underline-offset-2 hover:underline"
                  href="/pages"
                >
                  /pages directory
                </Link>
              </li>
            </ul>
          </div>
        </details>

        {issueDraft ? (
          <div className="space-y-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                btnMultiline,
                "border-violet-800/50 bg-violet-950/30 text-violet-100 hover:bg-violet-900/40"
              )}
              onClick={() => {
                const { title, body } =
                  buildGittrPagesManifestIssueDraft(issueDraft);
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
              }}
            >
              <FileText className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                New issue: manifest draft and checklist
              </span>
            </Button>
            <p className="text-[10px] leading-snug text-zinc-600">
              Opens this repo’s gittr issue composer with a pre-filled tracking
              note + JSON skeleton (kind <code className="text-zinc-500">35128</code>{" "}
              placeholders).
            </p>
          </div>
        ) : null}

        {canManageReadme ? (
          <div className="space-y-2 border-t border-violet-900/25 pt-2">
            {isOwnerSession && onAutoReadmeOnPushChange ? (
              <label className="flex cursor-pointer gap-2 rounded-md border border-violet-800/40 bg-violet-950/20 p-2 text-[11px] leading-snug text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-violet-600 bg-zinc-900 text-violet-500 focus:ring-violet-500/40"
                  checked={autoReadmeOnPush}
                  onChange={(e) => onAutoReadmeOnPushChange(e.target.checked)}
                  title="If off, Push requires a valid fenced README block with this repo’s live URL."
                />
                <span className="min-w-0">
                  <span className="font-medium text-zinc-200">
                    Let gittr update README for Pages on push
                  </span>
                  <span className="mt-1 block text-[10px] font-normal leading-snug text-zinc-500">
                    Before <strong className="text-zinc-400">Push to Nostr</strong>,
                    refresh the fenced gittr Pages block with this repo’s live URL.
                    If you turn this off, push stops unless that block already
                    contains the correct URL.
                  </span>
                </span>
              </label>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || chainActionsDisabled}
              className={cn(
                btnMultiline,
                "border-violet-500/50 text-violet-100 hover:bg-violet-900/30"
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
                {isOwnerSession
                  ? busy
                    ? "Updating README…"
                    : "Add gittr Pages links to README"
                  : busy
                  ? "Copying…"
                  : "Copy README snippet"}
              </span>
            </Button>
            {isOwnerSession && onReadmeThenPush ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || chainActionsDisabled}
                  className={cn(
                    btnMultiline,
                    "border-emerald-800/50 text-emerald-100 hover:bg-emerald-950/40"
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
                  Usual next step after you edit here: updates the Pages block,
                  then the same Push flow (signatures / payment if needed). No
                  relay refetch required for this tab after a successful push —
                  IDs are already stored locally.
                </p>
                {canChainNostrRefetch && onRefetchThenReadmeThenPush ? (
                  <>
                    <p className="text-[10px] leading-snug text-zinc-500">
                      Optional — only if this browser should re-read the repo from
                      relays before updating README and pushing (stale tree,
                      edits elsewhere, or you want to match relay state exactly).
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || chainActionsDisabled}
                      className={cn(
                        btnMultiline,
                        "border-sky-800/50 text-sky-100 hover:bg-sky-950/35"
                      )}
                      onClick={() => onRefetchThenReadmeThenPush()}
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 text-left font-medium">
                        Refetch Nostr → README + Push
                      </span>
                    </Button>
                    <p className="text-[10px] leading-snug text-zinc-500">
                      Full reload from relays, then README + Push on the next
                      load (use when local is not trusted).
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            {isOwnerSession ? (
              <p className="text-[10px] text-zinc-600">
                {onReadmeThenPush ? (
                  <>
                    Same <strong className="text-zinc-400">Push to Nostr</strong>{" "}
                    as the main button (signatures / payment if needed). Kind{" "}
                    <code className="text-zinc-400">35128</code> stays outside this
                    app. Relay gossip matters for other clients — not for forcing
                    a refetch on this device right after your own push.
                  </>
                ) : (
                  <>
                    Then use <strong className="text-zinc-400">Push to Nostr</strong>{" "}
                    again so everyone sees the README on relays (republish).
                  </>
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
