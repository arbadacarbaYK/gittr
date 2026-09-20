import { nostrGitArticleJsonLd, nostrGitFaqJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-script";
import {
  NOSTR_GIT_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = buildPageSiteMetadata({
  path: "/nostr-git",
  title: "What is Nostr git?",
  description: NOSTR_GIT_DESCRIPTION,
  imagePath: "/nostr-git/opengraph-image",
  imageAlt: "Nostr git hosting on gittr",
});

export default function NostrGitPage() {
  const siteUrl = getPublicSiteUrl();

  return (
    <article className="container mx-auto max-w-3xl p-6 text-[var(--color-text-secondary)]">
      <JsonLd data={nostrGitArticleJsonLd(siteUrl)} />
      <JsonLd data={nostrGitFaqJsonLd()} />
      <header className="mb-8">
        <p className="text-sm uppercase tracking-wide text-[var(--color-accent-primary)]">
          Protocol
        </p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--color-text-primary)]">
          What is Nostr git?
        </h1>
        <p className="mt-3 text-base leading-relaxed">
          Nostr git is git collaboration over the Nostr network. Repository
          names, issues, and pull requests are signed events (NIP-34). The git
          objects — trees, blobs, commits — still live on clone hosts.{" "}
          <Link
            href="/"
            className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
          >
            gittr
          </Link>{" "}
          is web hosting for that: a forge UI, SSH/HTTPS git, Pages, a Nostr
          apps catalog, and Lightning bounties.
        </p>
      </header>

      <section className="mb-8 space-y-3">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Git on Nostr, in practice
        </h2>
        <p>
          A public repo is an announcement event (kind 30617) plus git state
          (kind 30618). Anyone with the npub and repo name can find it on
          relays. Issues and pull requests are also signed events, so another
          Nostr git client can read the same conversation. Clone URLs point at
          real git servers (GRASP hosts and bridges such as{" "}
          <code className="text-[var(--color-text-primary)]">
            git.gittr.space
          </code>
          ).
        </p>
        <p>
          That split is the whole idea: metadata and review travel on relays;
          the bytes of the repo travel over git.
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          What gittr hosts
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Link
              href="/explore"
              className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
            >
              Public Nostr git repositories
            </Link>{" "}
            — browse announcements, then open Code, Issues, or PRs.
          </li>
          <li>
            <Link
              href="/new"
              className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
            >
              Create or mirror
            </Link>{" "}
            — new repos on Nostr git, or import from GitHub / GitLab / Codeberg
            as a backup that stays findable.
          </li>
          <li>
            <Link
              href="/apps"
              className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
            >
              Nostr apps
            </Link>{" "}
            — NIP-82 / Zapstore-style listings announced from git repos.
          </li>
          <li>
            <Link
              href="/pages"
              className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
            >
              gittr Pages
            </Link>{" "}
            — static sites published from Nostr (nsite).
          </li>
          <li>
            <Link
              href="/bounty-hunt"
              className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
            >
              Lightning bounties
            </Link>{" "}
            — fund an issue; pay when a gittr pull request is merged.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          How to clone
        </h2>
        <p>
          Open a repo and copy the clone URL. Day-to-day on gittr.space is SSH
          or HTTPS to the gitnostr bridge. Other clone hosts listed on the
          announcement work too. Setup and SSH keys:{" "}
          <Link
            href="/help#ssh-keys"
            className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
          >
            Help
          </Link>
          .
        </p>
      </section>

      <p className="text-sm">
        Longer cookbook:{" "}
        <Link
          href="/help"
          className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
        >
          Help &amp; documentation
        </Link>
        . Protocol notes live with the{" "}
        <Link
          href="/help#grasp"
          className="text-[var(--color-accent-primary)] underline-offset-2 hover:underline"
        >
          NIP-34 / GRASP
        </Link>{" "}
        section.
      </p>
    </article>
  );
}
