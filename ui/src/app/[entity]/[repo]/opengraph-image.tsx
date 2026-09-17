import { OG_SIZE } from "@/lib/seo/create-og-image";
import { createRepoOgImage } from "@/lib/seo/create-repo-og-image";
import { fetchRepoOgData } from "@/lib/seo/fetch-repo-og-data";
import { maybeRedirectVanityOgImage } from "@/lib/seo/vanity-repo-redirect";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

export const runtime = "nodejs";
/**
 * Cache at the edge for an hour so X/Telegram retries are fast.
 * Composition still refreshes on deploy (Next content-hash query) and
 * when layout bumps `?v=`.
 */
export const revalidate = 3600;

/**
 * Bump when OG composition / fetch budget changes so Next’s
 * `opengraph-image?<hash>` and crawler caches pick up a new URL.
 * about4: wrap About so it is not a one-liner under the logo.
 */
export const GITTR_OG_CARD_REV = "about4";
export const alt = "Repository on gittr";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const { entity, repo } = await params;
  let decodedRepo = repo;
  try {
    decodedRepo = decodeURIComponent(repo);
  } catch {
    decodedRepo = repo;
  }

  await maybeRedirectVanityOgImage(entity, decodedRepo);

  const data = await fetchRepoOgData(entity, decodedRepo, getPublicSiteUrl());
  void GITTR_OG_CARD_REV;
  return createRepoOgImage(data);
}
