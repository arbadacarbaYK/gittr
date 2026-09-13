import { Suspense } from "react";

import { buildPageSiteMetadata } from "@/lib/seo/site-metadata";

import { YourAppsClient } from "./YourAppsClient";

export const metadata = buildPageSiteMetadata({
  path: "/apps/mine",
  title: "Your Apps",
  description:
    "List and remove your NIP-82 app listings. A leftover app id is a second card until you send a delete request.",
});

export default function YourAppsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-white">Your Apps</h1>
      <Suspense fallback={null}>
        <YourAppsClient />
      </Suspense>
    </div>
  );
}
