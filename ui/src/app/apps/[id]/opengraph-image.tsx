import { GITTR_APP_OG_CARD_REV } from "@/lib/seo/app-og-card";
import { createAppOgImage } from "@/lib/seo/create-app-og-image";
import { OG_SIZE, createGittrOgImage } from "@/lib/seo/create-og-image";
import { fetchAppOgData } from "@/lib/seo/fetch-app-og-data";
import { APPS_MINE_SEGMENT } from "@/lib/seo/software-app-path";

export const runtime = "nodejs";
/** Cache the PNG so a messenger retry is fast. Bump app1 when the drawing changes. */
export const revalidate = 3600;

/**
 * app1 — per-app name, author, package id, summary, license, tags, icon.
 * Keep this comment in sync with GITTR_APP_OG_CARD_REV so the file hash moves.
 */
export { GITTR_APP_OG_CARD_REV };
void GITTR_APP_OG_CARD_REV;
export const alt = "Nostr app on gittr";
export const size = OG_SIZE;
export const contentType = "image/png";

function decodeAppId(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appId = decodeAppId(id || "");
  if (!appId || appId.toLowerCase() === APPS_MINE_SEGMENT) {
    return createGittrOgImage("Apps — NIP-82 software on Nostr");
  }
  try {
    const data = await fetchAppOgData(appId);
    return createAppOgImage(data);
  } catch {
    return createGittrOgImage("Apps — NIP-82 software on Nostr");
  }
}
