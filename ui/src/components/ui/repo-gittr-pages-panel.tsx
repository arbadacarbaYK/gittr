"use client";

import { Button } from "@/components/ui/button";

import { BookOpen, ChevronDown, ExternalLink, Globe } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type RepoGittrPagesPanelProps = {
  dTag: string;
  namedUrl: string;
  rootUrl: string;
  canManageReadme: boolean;
  /** Viewer is the repo owner (can use Push to Nostr in this UI). */
  isOwnerSession: boolean;
  onAppendReadme: () => void | Promise<void>;
};

export function RepoGittrPagesPanel({
  dTag,
  namedUrl,
  rootUrl,
  canManageReadme,
  isOwnerSession,
  onAppendReadme,
}: RepoGittrPagesPanelProps) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-violet-900/35 bg-violet-950/15 p-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Globe className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
        gittr Pages
      </h4>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
        After your NIP-5A manifest is on relays, the{" "}
        <span className="text-zinc-300">named</span> and{" "}
        <span className="text-zinc-300">root</span> URLs above go live. Order:{" "}
        <strong className="text-zinc-300">push repo → publish manifest</strong>{" "}
        (CLI or nsyte).
      </p>

      <details className="mt-2 group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet-300/90 hover:text-violet-200 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180" />
          How publishing works
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
            <a
              className="text-violet-400 underline-offset-2 hover:underline"
              href="https://nsyte.run"
              rel="noopener noreferrer"
              target="_blank"
            >
              nsyte.run
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
            </a>
          </li>
          <li>
            <Link
              className="text-violet-400 underline-offset-2 hover:underline"
              href="/pages"
            >
              Published sites directory
            </Link>
          </li>
        </ul>
      </details>

      {canManageReadme ? (
        <div className="mt-3 space-y-2 border-t border-violet-900/25 pt-3">
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
