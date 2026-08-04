import { OG_SIZE, createGittrOgImage } from "@/lib/seo/create-og-image";

export const runtime = "nodejs";

export const alt =
  "gittr — create a Nostr git repo or import from GitHub, GitLab, Codeberg";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return createGittrOgImage(
    "Create or import — Nostr git & foreign mirrors"
  );
}
