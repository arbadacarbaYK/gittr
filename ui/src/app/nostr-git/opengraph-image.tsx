import { OG_SIZE, createGittrOgImage } from "@/lib/seo/create-og-image";

export const runtime = "nodejs";

export const alt = "Why Nostr git — repos, pages, and apps that stay yours";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return createGittrOgImage("Repos, pages, and apps that stay yours");
}
