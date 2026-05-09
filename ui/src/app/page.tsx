import HomePageClient from "./home-page-client";

/**
 * Segment config must live in a Server Component. A `"use client"` page ignores
 * `dynamic` / `revalidate`, which left `/` statically prerendered with long
 * `s-maxage` — social crawlers often saw stale HTML and missing/wrong cards.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  return <HomePageClient />;
}
