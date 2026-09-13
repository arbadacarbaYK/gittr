"use client";

import {
  canCloseOrMergeOnGittr,
  issuePrOriginLabel,
} from "@/lib/utils/issue-pr-status";

import Link from "next/link";

type Row = { id?: string; html_url?: string; number?: string | number };

export function ForgeOriginNotice({
  kind,
  row,
}: {
  kind: "issue" | "pr";
  row: Row;
}) {
  const forge = !canCloseOrMergeOnGittr(row);
  const origin = issuePrOriginLabel(row);
  const url = typeof row.html_url === "string" ? row.html_url : "";
  const noun = kind === "pr" ? "pull request" : "issue";

  if (!forge) return null;

  return (
    <div
      className="mb-4 rounded-md border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100/95"
      role="status"
    >
      <p className="font-medium">
        This {noun} lives on {origin}.
      </p>
      <p className="mt-1 text-amber-100/80">
        gittr can show it and you can leave a comment here. Comments stay on
        Nostr/gittr — they are not posted back to {origin}. Close, merge, or
        reopen it on {origin} so the two sides do not drift.
      </p>
      {url ? (
        <p className="mt-2">
          <Link
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-200 underline hover:text-white"
          >
            Open on {origin}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function NostrCommentHint({
  forgeImported,
  hasNostrRoot,
}: {
  forgeImported: boolean;
  hasNostrRoot: boolean;
}) {
  if (forgeImported && !hasNostrRoot) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Notes here stay in this browser. There is no Nostr issue event to attach
        them to, so other git clients will not see them. To discuss on Nostr,
        open a gittr issue (long id in the URL).
      </p>
    );
  }
  if (forgeImported && hasNostrRoot) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Comments publish on Nostr for clients that merge kind 1111 threads. They
        are not copied to GitHub / Gitea / GitLab.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-gray-500">
      Comments publish on Nostr (kind 1111). Other NIP-34 clients that follow
      this issue will see them.
    </p>
  );
}

/** Small list marker: Nostr vs GitHub/GitLab/Gitea, linking to origin when known. */
export function IssuePrListOrigin({ row }: { row: Row }) {
  const nostr = canCloseOrMergeOnGittr(row);
  const origin = issuePrOriginLabel(row);
  const url = typeof row.html_url === "string" ? row.html_url : "";

  if (nostr) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        Nostr
      </span>
    );
  }

  if (url) {
    return (
      <Link
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] uppercase tracking-wide text-amber-500/90 hover:text-amber-300"
        title={`Open on ${origin}`}
        onClick={(e) => e.stopPropagation()}
      >
        {origin}
      </Link>
    );
  }

  return (
    <span className="text-[10px] uppercase tracking-wide text-amber-500/90">
      {origin}
    </span>
  );
}
