/**
 * Labels for the shared NIP-82 announce panel (Code sidebar + Releases tab).
 * Announce is always a concrete forge Release tag — never a tagless app.
 */

export function announcePanelSummaryLabel(args: {
  preferredTag?: string | null;
  loadedReleaseTag?: string | null;
  variant?: "sidebar" | "inline";
}): string {
  // Code sidebar sits next to "Nostr Pages" — keep that pair of names stable.
  // Tag / "latest" copy lives inside the open panel, not on the summary.
  if (args.variant === "sidebar") return "Nostr Apps";
  const preferred = (args.preferredTag || "").trim();
  if (preferred) return `Announce ${preferred}`;
  const loaded = (args.loadedReleaseTag || "").trim();
  if (loaded) return `Announce ${loaded}`;
  return "Announce on Nostr";
}

export function missingForgeSourceAnnounceMessage(): string {
  return "Link a GitHub, Codeberg, or GitLab source first (Settings → source). Announce always uses a hashed installer on a real forge Release tag — not a tagless app. Nostr-only file upload is not available yet; Releases can still save notes in this browser.";
}

export function formatAppAnnounceSuccessCopy(input: {
  appId: string;
  version: string;
}): string {
  return `✅ Live as ${input.appId}@${input.version}. See Apps.`;
}

export function formatAppAnnounceErrorCopy(message: string): string {
  const body = (message || "").trim() || "Publish failed";
  return `❌ ${body}`;
}
