"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  GITTR_PAGES_ISSUE_PREFILL_KEY,
  type GittrPagesIssueDraftInput,
  buildGittrPagesManifestIssueDraft,
} from "@/lib/gittr-pages/gittr-pages-issue-draft";
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

function hasGittrPagesEntryFile(
  files: Array<{ path?: string }> | undefined
): boolean {
  if (!files?.length) return false;
  return files.some((f) => {
    const p = (f.path || "").replace(/^\//, "").toLowerCase();
    return (
      p === "index.html" ||
      p.endsWith("/index.html") ||
      p === "404.html" ||
      p === "index.md"
    );
  });
}

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
};

/** Sidebar buttons: top-align so multi-line labels never sit on the next control. */
const btnMultiline = cn(
  "!h-auto min-h-9 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left text-xs font-normal leading-snug"
);

function configuredBlossomUploadBase(): string {
  const raw = (process.env.NEXT_PUBLIC_BLOSSOM_URL || "").trim();
  if (!raw) return "https://blossom.band";
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProto.replace(/\/$/, "");
}

/** Some public Blossoms are media-only; static `.js` for Pages then gets HTTP 415. */
function blossomHostMayRejectStaticScripts(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase();
    return h === "nostr.build" || h.endsWith(".nostr.build");
  } catch {
    return false;
  }
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
}: RepoGittrPagesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const blossomUploadBase = configuredBlossomUploadBase();
  const blossomStaticSiteWarning =
    Boolean(onPublishNamedSiteManifest) &&
    blossomHostMayRejectStaticScripts(blossomUploadBase);
  const [manifestBusy, setManifestBusy] = useState(false);

  const readmeOk =
    pagesReadiness &&
    (pagesReadiness.autoReadmeOnPush ||
      validateReadmeGittrPagesBlock(
        pagesReadiness.readme,
        pagesReadiness.namedUrl
      ).ok);
  const siteOk = pagesReadiness && hasGittrPagesEntryFile(pagesReadiness.files);
  const pushClean =
    pagesReadiness &&
    pagesReadiness.hasEverPushedToNostr &&
    !pagesReadiness.hasUnpushedEdits;
  const pushNeeded =
    pagesReadiness &&
    (pagesReadiness.hasUnpushedEdits || !pagesReadiness.hasEverPushedToNostr);
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

  return (
    <details className="group mt-3 rounded-lg border border-violet-900/35 bg-violet-950/15 open:bg-violet-950/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
        <Globe className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
        gittr Pages
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180" />
      </summary>

      <div className="flow-root space-y-3 border-t border-violet-900/25 px-3 pb-3 pt-2">
        {blossomStaticSiteWarning ? (
          <p className="rounded-md border border-amber-800/45 bg-amber-950/35 px-2 py-2 text-[10px] leading-snug text-amber-100/95">
            <strong className="text-amber-200">Upload host:</strong> this build
            sends Pages files to{" "}
            <code className="break-all text-amber-50/90">
              {blossomUploadBase}
            </code>
            . For full static sites (HTML, JS, CSS), set{" "}
            <code className="text-amber-50/90">NEXT_PUBLIC_BLOSSOM_URL</code> to{" "}
            <code className="text-amber-50/90">https://blossom.band</code> (or
            your own NIP-96 Blossom), run{" "}
            <code className="text-amber-50/90">yarn build</code>, restart{" "}
            <code className="text-amber-50/90">gittr-frontend</code>. See{" "}
            <Link
              className="font-medium text-amber-200 underline underline-offset-2 hover:text-amber-50"
              href="/help"
            >
              Help
            </Link>{" "}
            and{" "}
            <strong className="text-amber-200">SETUP_INSTRUCTIONS.md</strong>{" "}
            (Publish Pages / Blossom).
          </p>
        ) : null}
        <p className="text-[11px] leading-snug text-zinc-400">
          <strong className="text-zinc-300">What gittr signs today:</strong>{" "}
          repo tree + README to Nostr (same as always).{" "}
          <strong className="text-zinc-300">Named Pages manifest:</strong>{" "}
          owners can use{" "}
          <strong className="text-zinc-300">Publish Pages manifest</strong>{" "}
          below — Blossom uploads (via gittr proxy) + kind{" "}
          <code className="text-zinc-500">35128</code> with NIP-07 (several sign
          prompts). The gateway lists the site after relays see that event. The{" "}
          <strong className="text-zinc-300">Live site</strong> link may show
          “Site not found” until then.{" "}
          <strong className="text-zinc-300">Issues</strong> are optional notes
          only; closing them does not publish the manifest.
        </p>

        {pagesReadiness && isOwnerSession ? (
          <div
            className={cn(
              "rounded-md border px-2 py-2 text-[10px] leading-snug",
              gittrStepsReady
                ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-100/90"
                : "border-violet-800/40 bg-violet-950/25 text-zinc-300"
            )}
          >
            <p className="mb-2 font-medium text-zinc-200">
              Status (gittr can help)
            </p>
            <ul className="space-y-2">
              <li className="flex gap-2">
                {siteOk ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                )}
                <span>
                  <strong className="text-zinc-200">Site entry file</strong> —{" "}
                  {siteOk
                    ? "Found something like index.html in this repo."
                    : "Add index.html (or similar) to the repo tree so the site has a root page."}
                </span>
              </li>
              <li className="flex gap-2">
                {readmeOk ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                )}
                <span>
                  <strong className="text-zinc-200">README + live URL</strong> —{" "}
                  {readmeOk
                    ? "Valid fenced block or auto-update on push is on."
                    : "Turn on auto-update or add the fenced gittr Pages block with this repo’s live URL."}
                </span>
              </li>
              <li className="flex gap-2">
                {pushClean ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : pushNeeded ? (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500/90" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                )}
                <span>
                  <strong className="text-zinc-200">Metadata on relays</strong>{" "}
                  —{" "}
                  {pushClean
                    ? "Nothing pending — last Push to Nostr is reflected locally."
                    : pagesReadiness.hasUnpushedEdits
                    ? "You have unpublished edits — use Push to Nostr in Repository Status when ready."
                    : "Not published yet — push the repo when site + README rows look good."}
                </span>
              </li>
              <li className="flex gap-2">
                {gatewayListsSite === true ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : gatewayListsSite === false ? (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500/90" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                )}
                <span
                  className={
                    gatewayListsSite === false ? "text-amber-100/90" : ""
                  }
                >
                  <strong className="text-zinc-200">
                    Gateway lists this site
                  </strong>{" "}
                  —{" "}
                  {gatewayListsSite === true
                    ? "pages.gittr.space directory includes this named URL (manifest + blobs reached the gateway)."
                    : gatewayListsSite === false
                    ? "Not in the directory yet — publish 35128 + blobs with your signer; “Site not found” on the live link is expected until this turns green."
                    : "Checking directory… if this stays grey, the status API may be unreachable."}
                </span>
              </li>
            </ul>
            {gittrStepsReady ? (
              <p className="mt-2 border-t border-emerald-800/40 pt-2 text-emerald-100/95">
                Gittr-side repo + README steps look good — use{" "}
                <strong className="text-white">Push to Nostr</strong> above if
                you still have unpublished edits; then run{" "}
                <strong className="text-white">Publish Pages manifest</strong>{" "}
                when you are ready for the gateway (Blossom + 35128).
              </p>
            ) : (
              <p className="mt-2 border-t border-violet-800/30 pt-2 text-zinc-500">
                Use the buttons below for README shortcuts;{" "}
                <strong className="text-zinc-400">Push to Nostr</strong> stays
                in Repository Status above.
              </p>
            )}
          </div>
        ) : null}

        <details className="group/sub rounded-md border border-violet-900/20 bg-violet-950/10">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3 w-3 shrink-0 transition group-open/sub:rotate-180" />
            Steps &amp; links
          </summary>
          <div className="space-y-2 border-t border-violet-900/15 px-2 py-2 text-[10px] leading-relaxed text-zinc-500">
            <ol className="list-decimal space-y-1.5 pl-3 marker:text-zinc-600">
              <li>
                Site files in this repo — edit here;{" "}
                <strong className="text-zinc-400">Refetch from Nostr</strong>{" "}
                only if this copy might be behind relays (optional after your
                own push in this tab).
              </li>
              <li>
                README Pages block —{" "}
                <strong className="text-zinc-400">README + Push</strong>, or the
                separate README button / “update on push” checkbox then Push.
              </li>
              <li>
                <strong className="text-zinc-400">Push to Nostr</strong> — repo
                + readme metadata (included in the shortcut above).
              </li>
              <li>
                <strong className="text-zinc-400">35128</strong> manifest +
                Blossom blobs — use{" "}
                <strong className="text-zinc-400">
                  Publish Pages manifest
                </strong>{" "}
                (owner, NIP-07) or any other NIP-5A tool you prefer.
              </li>
            </ol>
            <p className="text-zinc-600">
              <strong className="text-zinc-500">Default path:</strong> fix files
              → <strong className="text-zinc-400">README + Push</strong> (same
              session; push already saved event IDs here).{" "}
              <strong className="text-zinc-500">Optional chain:</strong> refetch
              first only when you need relays as read truth, then README + Push.{" "}
              Then{" "}
              <strong className="text-zinc-400">Publish Pages manifest</strong>{" "}
              so the gateway can serve the live URL.
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

        {isOwnerSession && onPublishNamedSiteManifest ? (
          <div className="space-y-1.5 border-t border-violet-900/25 pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={manifestBusy || chainActionsDisabled}
              className={cn(
                btnMultiline,
                "border-amber-700/50 bg-amber-950/25 text-amber-100 hover:bg-amber-950/40"
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
                  ? "Publishing manifest (sign prompts)…"
                  : "Publish Pages manifest (Blossom + kind 35128)"}
              </span>
            </Button>
            <p className="text-[10px] leading-snug text-zinc-600">
              Uses{" "}
              <code className="text-zinc-500">NEXT_PUBLIC_BLOSSOM_URL</code>{" "}
              (via gittr proxy). You will get one NIP-07 prompt per file, then
              one for the manifest. Large binary trees may exceed limits — keep
              the site lean or host heavy assets elsewhere.
            </p>
          </div>
        ) : null}

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
              note + JSON skeleton (kind{" "}
              <code className="text-zinc-500">35128</code> placeholders).
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
                    Before{" "}
                    <strong className="text-zinc-400">Push to Nostr</strong>,
                    refresh the fenced gittr Pages block with this repo’s live
                    URL. If you turn this off, push stops unless that block
                    already contains the correct URL.
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
                      Optional — only if this browser should re-read the repo
                      from relays before updating README and pushing (stale
                      tree, edits elsewhere, or you want to match relay state
                      exactly).
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
                    Same{" "}
                    <strong className="text-zinc-400">Push to Nostr</strong> as
                    the main button (signatures / payment if needed). Use{" "}
                    <strong className="text-zinc-400">
                      Publish Pages manifest
                    </strong>{" "}
                    for Blossom + kind{" "}
                    <code className="text-zinc-400">35128</code>.
                  </>
                ) : (
                  <>
                    Then use{" "}
                    <strong className="text-zinc-400">Push to Nostr</strong>{" "}
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
