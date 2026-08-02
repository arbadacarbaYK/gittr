import { createRepoOgImage } from "@/lib/seo/create-repo-og-image";
import { OG_SIZE } from "@/lib/seo/create-og-image";
import { fetchRepoOgData } from "@/lib/seo/fetch-repo-og-data";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

export const runtime = "nodejs";
/** Always rebuild — owner picture / stars change; avoid year-long stale cards. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Bump when OG composition changes so Next’s `opengraph-image?<hash>` and
 * crawler caches (X Card Validator) pick up a new URL. Pic 220px: v4.
 */
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

  const data = await fetchRepoOgData(
    entity,
    decodedRepo,
    getPublicSiteUrl()
  );
  return createRepoOgImage(data);
}
