import { createGittrOgImage } from "@/lib/seo/create-og-image";

export const runtime = "nodejs";
export const dynamic = "force-static";

/** Fresh path so Telegram does not reuse the cached `/opengraph-image` picture. */
export async function GET() {
  return createGittrOgImage("gits announced to Nostr");
}
