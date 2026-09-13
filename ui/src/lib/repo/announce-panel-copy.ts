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

/** Extra screenshot URL paste is for third-party apps, not gittr’s own listing. */
export function announceScreenshotExtrasFieldVisible(
  isOfficialGittr: boolean
): boolean {
  return !isOfficialGittr;
}

export function announceScreenshotHelpCopy(args: {
  isOfficialGittr: boolean;
  yamlFound: boolean;
  yamlScreenshotCount: number;
}): string {
  if (args.isOfficialGittr) {
    return "gittr’s store screenshots (zapstore.yaml images:). Change the files under ui/public/zapstore/, then announce again.";
  }
  if (args.yamlFound && args.yamlScreenshotCount > 0) {
    return "From images: in this source repo’s zapstore.yaml. Other apps can add extra https screenshot URLs below.";
  }
  if (args.yamlFound) {
    return "Found zapstore.yaml but no images: yet. Add PNG/JPG paths or https links there, or paste extra URLs below.";
  }
  return "Put images: in zapstore.yaml at the source repo root (same file Zapstore already reads). Paths like ./screenshots/home.png or https links. Optional extra URLs below.";
}
