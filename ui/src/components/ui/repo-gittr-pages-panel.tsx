"use client";

import { Button } from "@/components/ui/button";
import {
  GITTR_PAGES_ISSUE_PREFILL_KEY,
  buildGittrPagesManifestIssueDraft,
  type GittrPagesIssueDraftInput,
} from "@/lib/gittr-pages/gittr-pages-issue-draft";

import { BookOpen, ChevronDown, ExternalLink, FileText, Globe } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RepoGittrPagesPanelProps = {
  canManageReadme: boolean;
  /** Viewer is the repo owner (can use Push to Nostr in this UI). */
  isOwnerSession: boolean;
  /** Owner: when true, Push to Nostr refreshes the README gittr Pages block first; when false, push requires a valid block. */
  autoReadmeOnPush?: boolean;
  onAutoReadmeOnPushChange?: (value: boolean) => void;
  onAppendReadme: () => void | Promise<void>;
  /** When set, show “open issue with draft” (this gittr repo only — not GitHub). */
  issueDraft?: GittrPagesIssueDraftInput | null;
};

export function RepoGittrPagesPanel({
  canManageReadme,
  isOwnerSession,
  autoReadmeOnPush = false,
  onAutoReadmeOnPushChange,
  onAppendReadme,
  issueDraft,
}: RepoGittrPagesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-violet-900/35 bg-violet-950/15 p-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Globe className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
        gittr Pages
      </h4>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
        After a <span className="text-zinc-300">NIP-5A site manifest</span> for
        this repo is on relays, your{" "}
        <span className="text-zinc-300">live site URL</span> (shown above) is
        served by gittr’s gateway. The README control below only helps visitors
        see that URL in the repo readme — it does not publish the Nostr
        manifest (use your usual NIP-5A / nsite tooling for that).
      </p>

      <details className="mt-2 group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180" />
          Order when something is missing or wrong
        </summary>
        <ol className="mt-2 list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-zinc-500 marker:text-zinc-600">
          <li>
            <span className="text-zinc-400">
              <strong className="text-zinc-300">Site files in this gittr repo</strong>{" "}
              — add or fix what the site actually serves (at minimum something
              that resolves to <code className="text-zinc-400">/index.html</code>
              ). If your checkout is empty or stale, use{" "}
              <strong className="text-zinc-300">Refetch from Nostr</strong> on
              this repo (not an import source), then edit here. gittr does not
              invent HTML for you.
            </span>
          </li>
          <li>
            <span className="text-zinc-400">
              <strong className="text-zinc-300">README (optional)</strong> — the
              button or “update on push” checkbox only maintains the fenced{" "}
              <strong className="text-zinc-300">gittr Pages</strong> block with
              your live URL. Wrong or partial <em>README</em> text does not fix
              the gateway; wrong <em>site files</em> must be fixed in step 1.
            </span>
          </li>
          <li>
            <span className="text-zinc-400">
              <strong className="text-zinc-300">Push repo to Nostr</strong> — so
              relays (and git) carry your updated tree and README metadata.
            </span>
          </li>
          <li>
            <span className="text-zinc-400">
              <strong className="text-zinc-300">Publish the NIP-5A page</strong>{" "}
              — a <strong className="text-zinc-300">site manifest</strong> on
              relays (kind <code className="text-zinc-400">35128</code> for a
              named site), mapping paths to blob hashes. The gateway reads
              that; gittr’s web UI does not publish this yet — use your nsite /
              NIP-5A CLI or flow after blobs exist. Some tools combine blob
              upload + manifest publish in one command after the repo is ready.
            </span>
          </li>
        </ol>
        <p className="mt-2 pl-1 text-[11px] leading-relaxed text-zinc-600">
          So yes: <strong className="text-zinc-400">files → merge locally →</strong>{" "}
          optional README help →{" "}
          <strong className="text-zinc-400">push repo → publish NIP-5A manifest</strong>
          . Steps 1–3 are ordered; step 4 must see the blobs it references, so
          it usually comes after the repo (or the same toolchain) has the
          content it will hash.
        </p>
      </details>

      <details className="mt-2 group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180" />
          Full “gittr does it all” (future)
        </summary>
        <p className="mt-2 pl-1 text-[11px] leading-relaxed text-zinc-500">
          A single guided flow would still mean <strong className="text-zinc-400">several signatures</strong>{" "}
          (repo push, NIP-5A manifest publish, maybe README/repo metadata). We
          have not wired that wizard yet; the issue draft button below is the
          supported manual handoff on <strong className="text-zinc-400">this</strong>{" "}
          gittr repo only.
        </p>
      </details>

      <details className="mt-2 group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180" />
          Links
        </summary>
        <ul className="mt-2 space-y-1.5 pl-1 text-[11px] leading-relaxed text-zinc-500">
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
              Published sites directory (gittr)
            </Link>
          </li>
          <li className="text-zinc-500">
            NIP-5A also allows a separate “root” host (
            <code className="text-zinc-400">npub…</code>
            ); gittr still serves it, but the README tools only mention your
            named-site URL.
          </li>
        </ul>
      </details>

      {issueDraft ? (
        <div className="mt-3 border-t border-violet-900/25 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full gap-2 border-violet-800/50 bg-violet-950/30 text-violet-100 hover:bg-violet-900/40"
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
            New issue: manifest draft and checklist
          </Button>
          <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
            Opens <strong className="text-zinc-500">this repo’s</strong> gittr
            issue composer with a pre-filled tracking note + JSON skeleton (same
            app only — not another website’s issue tracker). You still edit files
            here and sign the real NIP-5A event with your tooling; the README
            block is still the separate sidebar control if you want the link in
            the readme.
          </p>
        </div>
      ) : null}

      {canManageReadme ? (
        <div className="mt-3 space-y-2 border-t border-violet-900/25 pt-3">
          {isOwnerSession && onAutoReadmeOnPushChange ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-violet-900/30 bg-violet-950/20 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-violet-600 bg-zinc-900 text-violet-500 focus:ring-violet-500/40"
                checked={autoReadmeOnPush}
                onChange={(e) => onAutoReadmeOnPushChange(e.target.checked)}
              />
              <span>
                <span className="font-medium text-zinc-300">
                  Let gittr update README for Pages on push
                </span>
                — before <strong className="text-zinc-400">Push to Nostr</strong>
                , refresh the fenced gittr Pages block with this repo’s live URL.
                If you turn this off, push will stop unless that block already
                contains the correct URL.
              </span>
            </label>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            className="w-full gap-2 border-violet-500/50 text-violet-100 hover:bg-violet-900/30"
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
            {isOwnerSession
              ? busy
                ? "Updating README…"
                : "Add gittr Pages links to README"
              : busy
              ? "Copying…"
              : "Copy README snippet for gittr Pages"}
          </Button>
          {isOwnerSession ? (
            <p className="text-[11px] leading-snug text-zinc-500">
              Then use <strong className="text-zinc-400">Push to Nostr</strong>{" "}
              again so everyone sees the README on relays (republish).
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-zinc-500">
              Paste into README where you have write access, then ask the repo
              owner to <strong className="text-zinc-400">Push to Nostr</strong>{" "}
              so all clients pick it up.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
