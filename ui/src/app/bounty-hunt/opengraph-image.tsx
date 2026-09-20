import { OG_SIZE, createGittrOgImage } from "@/lib/seo/create-og-image";

export const runtime = "nodejs";

export const alt = "gittr Bounty Hunt — Lightning bounties on Nostr git";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return createGittrOgImage("Bounty Hunt — Lightning on Nostr git");
}
