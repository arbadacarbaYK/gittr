/**
 * Labels for the shared NIP-82 announce panel (Code sidebar + Releases tab).
 * Announce is always a concrete forge Release tag — never a tagless app.
 */

export function announcePanelSummaryLabel(args: {
  preferredTag?: string | null;
  loadedReleaseTag?: string | null;
  variant?: "sidebar" | "inline";
}): string {
  const preferred = (args.preferredTag || "").trim();
  if (preferred) return `Announce ${preferred}`;
  const loaded = (args.loadedReleaseTag || "").trim();
  if (loaded) return `Announce ${loaded}`;
  if (args.variant === "inline") return "Announce on Nostr";
  return "Nostr Apps · latest";
}

export function missingForgeSourceAnnounceMessage(): string {
  return "Link a GitHub, Codeberg, or GitLab source first (Settings → source). Announce always uses a hashed installer on a real forge Release tag — not a tagless app. Nostr-only file upload is not available yet; Releases can still save notes in this browser.";
}
