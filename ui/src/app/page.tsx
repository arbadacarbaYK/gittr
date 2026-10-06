import {
  hasAnyLeaderboardData,
  loadPlatformLeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";
import { softwareApplicationJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-script";
import { HOME_CARD_PATH, SITE_TITLE_DEFAULT } from "@/lib/seo/site-copy";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type Metadata } from "next";

import HomePageClient from "./home-page-client";

/**
 * Segment config must live in a Server Component. A `"use client"` page ignores
 * `dynamic` / `revalidate`, which left `/` statically prerendered with long
 * `s-maxage` — social crawlers often saw stale HTML and missing/wrong cards.
 */
export const dynamic = "force-dynamic";

/**
 * The root `opengraph-image.tsx` overwrites layout images on `/` itself.
 * Setting them on this page keeps Telegram on `/og/home-card` instead of the
 * cached `/opengraph-image` picture.
 */
const homeCardUrl = `${getPublicSiteUrl()}${HOME_CARD_PATH}`;
export const metadata: Metadata = {
  openGraph: {
    images: [
      {
        url: homeCardUrl,
        secureUrl: homeCardUrl,
        width: 1200,
        height: 630,
        alt: SITE_TITLE_DEFAULT,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [homeCardUrl],
  },
};

export default async function Page() {
  const snapshot = await loadPlatformLeaderboardSnapshot();
  const initialLeaderboard =
    snapshot && hasAnyLeaderboardData(snapshot)
      ? {
          topRepos: snapshot.topRepos,
          topUsers: snapshot.topUsers,
          recentRepos: snapshot.recentRepos,
          recentActivities: snapshot.recentActivities,
          snapshotAt: snapshot.at,
        }
      : null;

  return (
    <>
      <JsonLd data={softwareApplicationJsonLd(getPublicSiteUrl())} />
      <HomePageClient initialLeaderboard={initialLeaderboard} />
    </>
  );
}
