import { GITTR_DOC_README_PATH } from "@/lib/gittr-repo-links";
import { nostrGitArticleJsonLd, nostrGitFaqJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-script";
import {
  NOSTR_GIT_DESCRIPTION,
  NOSTR_GIT_FAQ,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = buildPageSiteMetadata({
  path: "/nostr-git",
  title: "Why Nostr git",
  description: NOSTR_GIT_DESCRIPTION,
  imagePath: "/nostr-git/opengraph-image",
  imageAlt: "Why Nostr git — repos, pages, and apps that stay yours",
});

const linkClass =
  "text-[var(--color-accent-primary)] underline-offset-2 hover:underline";

const problems = [
  {
    title: "One outage, or one takedown, and the project is gone",
    body: "GitHub, GitLab, and the other big hosts go down. They can also remove a repository. When they do, the code, the issues, and the project page disappear together.",
  },
  {
    title: "A server you run at home is hard for anyone else to find",
    body: "Forgejo, Gitea, and the other forges on your own machine keep the files on hardware you control. They do not put the project on a map people can search. If someone does not already have your address, the project does not exist for them. There is also no public way for a visitor to support the person who built it.",
  },
  {
    title: "App stores cannot show who you already trust",
    body: "A store badge is the store’s word. It does not tell you the app comes from someone in the network of people you follow, and it does not hand you the source so you can check the code. The store can also refuse the app.",
  },
];

const outcomes = [
  {
    title: "People can actually find it",
    body: "A repository, a website, or an app shows up in any Nostr git, pages, or apps client. gittr is one of those windows.",
  },
  {
    title: "A push writes a backup immediately",
    body: "Push a repo, a page, or an app and a copy lands on Nostr git servers right away. The project is not left on a single disk.",
  },
  {
    title: "You can see it is really them",
    body: "When you are logged in, a listing shows how close the author is to people you already follow. The listing also links back to the repository, so you can read the code the app was built from. No central store has to approve it first.",
  },
  {
    title: "You can support the developer",
    body: "Visitors can send Lightning to the person who published the work. A project that only lives on a private forge has no public way to do that.",
  },
  {
    title: "One key, every client",
    body: "The same Nostr key opens your repos, pages, and apps in every compatible client. The software is free and open source, so you can run your own client or server and still see the same projects.",
  },
];

export default function NostrGitPage() {
  const siteUrl = getPublicSiteUrl();

  return (
    <article className="container mx-auto max-w-3xl px-6 py-10 text-[var(--color-text-secondary)]">
      <JsonLd data={nostrGitArticleJsonLd(siteUrl)} />
      <JsonLd data={nostrGitFaqJsonLd()} />

      <header className="mb-10">
        <p className="text-sm uppercase tracking-wide text-[var(--color-accent-primary)]">
          Why it exists
        </p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--color-text-primary)] sm:text-4xl">
          Your work should survive the host
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-text-primary)]">
          Nostr git is a public layer for code, websites, and apps. The project
          stays findable when a company is down or decides you do not belong,
          and a server in your house is no longer a secret URL.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          What goes wrong today
        </h2>
        <ul className="mt-4 space-y-3">
          {problems.map((item) => (
            <li
              key={item.title}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5"
            >
              <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          What you get instead
        </h2>
        <ul className="mt-4 space-y-5">
          {outcomes.map((item) => (
            <li key={item.title}>
              <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                {item.title}
              </h3>
              <p className="mt-1 leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Start with one of these
        </h2>
        <p className="mt-3 leading-relaxed">
          <Link
            href="/new"
            className="inline-flex rounded-md bg-[var(--color-accent-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Publish a repository
          </Link>
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          <li>
            <Link href="/explore" className={linkClass}>
              Browse public repositories
            </Link>
          </li>
          <li>
            <Link href="/apps" className={linkClass}>
              Browse apps
            </Link>{" "}
            with the author&apos;s trust badge and a link to the source
          </li>
          <li>
            <Link href="/pages" className={linkClass}>
              Open published websites
            </Link>
          </li>
          <li>
            <Link href="/bounty-hunt" className={linkClass}>
              Fund an issue with Lightning
            </Link>
          </li>
        </ul>
      </section>

      <section className="mb-10 space-y-3">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Common questions
        </h2>
        <dl className="space-y-4">
          {NOSTR_GIT_FAQ.map((item) => (
            <div key={item.name}>
              <dt className="font-semibold text-[var(--color-text-primary)]">
                {item.name}
              </dt>
              <dd className="mt-1 leading-relaxed">{item.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3 border-t border-[var(--color-border)] pt-8 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          For Nostr and Lightning developers
        </h2>
        <p>
          A public repository is an announcement you sign, plus the git history.
          Issues and pull requests are signed the same way, so any Nostr git
          client can show the same conversation. The files are copied to git
          servers (GRASP hosts), including{" "}
          <code className="text-[var(--color-text-primary)]">
            git.gittr.space
          </code>
          . The spec is NIP-34. Clone URLs and SSH keys are in{" "}
          <Link href="/help#ssh-keys" className={linkClass}>
            Help
          </Link>
          . Protocol notes are under{" "}
          <Link href="/help#grasp" className={linkClass}>
            NIP-34 / GRASP
          </Link>
          . The full map of this site is the{" "}
          <Link href={GITTR_DOC_README_PATH} className={linkClass}>
            gittr README
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
