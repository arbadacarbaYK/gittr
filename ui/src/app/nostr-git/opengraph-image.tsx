import { OG_SIZE, createGittrOgImage } from "@/lib/seo/create-og-image";

export const runtime = "nodejs";

export const alt = "Nostr git hosting on gittr";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return createGittrOgImage("Nostr git hosting");
}
