import { buildPageSiteMetadata } from "@/lib/seo/site-metadata";
import {
  omalauncherShareUrl,
  owlShareToken,
} from "@/lib/widgets/omalauncher-share";

import fs from "fs";
import path from "path";

export const metadata = buildPageSiteMetadata({
  path: "/omalauncher",
  title: "Add gittr to Omalauncher",
  description:
    "Add the Nostr git and newest Nostr apps tiles to an Omalauncher home screen.",
});

function tileToken(fileName: string): string {
  const text = fs.readFileSync(
    path.join(process.cwd(), "public", "omalauncher", fileName),
    "utf8"
  );
  return owlShareToken(text);
}

export default function OmalauncherInstallPage() {
  const gitHref = omalauncherShareUrl(tileToken("nostr-git.owl"));
  const appsHref = omalauncherShareUrl(tileToken("nostr-apps.owl"));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm uppercase tracking-wide text-purple-400">
        Phone home screen
      </p>
      <h1 className="mt-2 text-3xl font-bold theme-text-primary">
        Add gittr to Omalauncher
      </h1>
      <p className="mt-4 text-gray-300 leading-relaxed">
        Omalauncher is the Android home screen. Each button opens the tile page.
        On that page, tap Open in Omalauncher. The launcher shows the tile and
        asks before it keeps it. Linux is not required.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <a
          href={gitHref}
          className="rounded-lg bg-purple-600 px-4 py-3 text-center font-semibold text-white hover:bg-purple-500"
        >
          Add Nostr git
        </a>
        <a
          href={appsHref}
          className="mt-4 rounded-lg bg-purple-600 px-4 py-3 text-center font-semibold text-white hover:bg-purple-500"
        >
          Add Nostr apps
        </a>
      </div>

      <p className="mt-8 text-sm text-gray-400 leading-relaxed">
        Nostr git is the repos trending this week, same list as the gittr home
        page. Nostr apps is the newest apps, with search.{" "}
        <a
          href="https://github.com/SimonSchubert/omarchy-widgets"
          className="text-purple-300 hover:text-purple-200"
          target="_blank"
          rel="noreferrer"
        >
          The widget store
        </a>{" "}
        is where reviewed tiles live. A phone can add these two before that
        store lists them.
      </p>
      <p className="mt-3 text-sm text-gray-400">
        <a
          href="https://play.google.com/store/apps/details?id=dev.omalauncher"
          className="text-purple-300 hover:text-purple-200"
          target="_blank"
          rel="noreferrer"
        >
          Omalauncher on Google Play
        </a>
      </p>
    </main>
  );
}
