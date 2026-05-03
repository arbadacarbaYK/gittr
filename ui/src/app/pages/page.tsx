import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ExternalLink, LayoutGrid, Radio } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "gittr Pages",
  description:
    "Nostr-hosted static sites (NIP-5A) via the gittr Pages gateway — open the live directory or status.",
};

const pagesBase =
  (process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space").replace(
    /\/$/,
    ""
  );

export default function GittrPagesHubPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 md:py-14">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
          gittr Pages
        </h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-400">
          Static sites published on Nostr (
          <a
            className="text-violet-400 underline-offset-2 hover:underline"
            href="https://github.com/nostr-protocol/nips/blob/master/5A.md"
            rel="noopener noreferrer"
            target="_blank"
          >
            NIP-5A
          </a>
          ) are listed and served through our gateway at{" "}
          <span className="font-mono text-zinc-300">{pagesBase}</span>. Browse
          the directory, open a site by npub subdomain, or inspect relay cache
          on the status page.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          className="group flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 transition hover:border-violet-500/50 hover:bg-zinc-900/80"
          href={pagesBase}
          rel="noopener noreferrer"
          target="_blank"
        >
          <LayoutGrid className="mb-3 h-8 w-8 text-violet-400" aria-hidden />
          <h2 className="text-lg font-semibold text-white">Site directory</h2>
          <p className="mt-1 flex-1 text-sm text-zinc-400">
            Gateway home — discover cached nsite manifests and open sites.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-400 group-hover:text-violet-300">
            Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </span>
        </a>

        <a
          className="group flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 transition hover:border-violet-500/50 hover:bg-zinc-900/80"
          href={`${pagesBase}/status`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Radio className="mb-3 h-8 w-8 text-violet-400" aria-hidden />
          <h2 className="text-lg font-semibold text-white">Status</h2>
          <p className="mt-1 flex-1 text-sm text-zinc-400">
            Manifests, paths, and relay hints for debugging and exploration.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-400 group-hover:text-violet-300">
            Open status <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </span>
        </a>
      </div>

      <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
        <p>
          Self-hosters: set{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
            NEXT_PUBLIC_GITTR_PAGES_URL
          </code>{" "}
          in{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
            .env.local
          </code>{" "}
          to your gateway URL (no trailing slash).
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          className={cn(buttonVariants({ variant: "default" }))}
          href={pagesBase}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open gateway
        </a>
        <Link
          className={cn(buttonVariants({ variant: "outline" }))}
          href="/repositories"
        >
          Back to repositories
        </Link>
      </div>
    </div>
  );
}
