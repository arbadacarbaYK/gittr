import { forgeReleaseTagsMatch } from "./forge-releases";

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
  const loaded = (args.loadedReleaseTag || "").trim();
  if (loaded && preferred && forgeReleaseTagsMatch(loaded, preferred)) {
    return `Announce ${loaded}`;
  }
  if (preferred) return `Announce ${preferred}`;
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

export function shortCertificateHash(hash: string): string {
  const value = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function announceCertificateRowTitle(hash?: string): string {
  if (!hash) return "Signing certificate (check the file)";
  return `Certificate ${shortCertificateHash(hash)}`;
}

export function announceZapstoreProofMessage(args: {
  reason:
    | "missing"
    | "expired"
    | "revoked"
    | "mismatch"
    | "unreachable"
    | "unreadable-cert"
    | "relay-rejected";
  certificateHash?: string;
}): string {
  const cert = args.certificateHash
    ? ` Certificate ${shortCertificateHash(args.certificateHash)}.`
    : "";
  switch (args.reason) {
    case "unreadable-cert":
      return "Zapstore needs the signing certificate inside this APK. This file’s signature block could not be read. Use a release APK signed with Android signature scheme v2 or v3, check the file again, then publish.";
    case "missing":
      return `Zapstore will not list this app until you prove this signing certificate is yours. On your computer, run zsp and choose “Prove it’s yours”. The keystore stays on that machine.${cert} When that proof is on Nostr, publish this release again from here.`;
    case "expired":
      return `The proof that this signing certificate is yours has expired. Run zsp again and choose “Prove it’s yours”, then publish this release again.${cert}`;
    case "revoked":
      return `The proof that this signing certificate is yours was revoked. Run zsp again and choose “Prove it’s yours”, then publish this release again.${cert}`;
    case "mismatch":
      return `A proof is on the relays for this certificate, but it does not match this APK’s signing key. Run zsp and prove the keystore that signed this exact file, then publish again.${cert}`;
    case "unreachable":
      return "gittr could not reach the relays to check your ownership proof. Wait a moment and publish again.";
    case "relay-rejected":
      return "Zapstore’s relay did not keep this listing, so the file event was removed. A file event left without its release is dropped. If this is the first publish, commit zapstore.yaml at the repo root with your pubkey and repository URL, then publish again.";
  }
}

export function announceZapstoreFooterCopy(): string {
  return "Zapstore lists an Android app only after a one-time proof that the signing certificate is yours (run zsp and choose “Prove it’s yours”; the keystore stays on your computer). Also commit zapstore.yaml at the source repo root with pubkey, repository, and images: for screenshots.";
}

export function announceSkippedApkNote(names: string[]): string {
  return `Left out ${names
    .filter(Boolean)
    .join(
      ", "
    )}. Zapstore accepts an APK only when its signing certificate is already proven as yours.`;
}

export function announcePanelBlossomCopy(isOfficialGittr: boolean): string {
  if (isOfficialGittr) {
    return "This is gittr’s own Android app — pin the APK to gittr’s Blossom.";
  }
  return "Optional: pin a copy onto public Blossom hosts (not gittr’s Pages Blossom).";
}
