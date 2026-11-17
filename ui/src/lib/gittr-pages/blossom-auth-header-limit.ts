/**
 * blossom.gittr.space nginx uses the default header buffer: one request
 * header line, 8 KB. Push Manifest puts every file hash into one kind 24242
 * event and sends it as `Authorization: Nostr <base64url>`. Past this size
 * nginx answers 400 with an HTML page. We stop first and say why.
 * Do not raise the buffer and do not split the signature into batches.
 */
export const GITTR_PAGES_AUTH_HEADER_MAX = 8000;

/** Same encoding as the Pages upload proxy (`Buffer#toString("base64url")`, no padding). */
export function nostrAuthorizationHeaderLength(event: unknown): number {
  const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
  const unpadded =
    Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);
  return "Nostr ".length + unpadded;
}

export function withSignedAuthStandIn<T extends { id: string; sig: string }>(
  event: T
): T {
  return {
    ...event,
    id: "a".repeat(64),
    sig: "b".repeat(128),
  };
}

export function pagesPublishTooManyFilesMessage(
  fileCount: number,
  maxFiles: number
): string {
  return (
    `This page has ${fileCount} files. gittr can publish ${maxFiles} files in one go. ` +
    "Past that, the upload signature is longer than our server accepts, so the publish stops before you are asked to sign. " +
    `Remove files until you are at ${maxFiles} or fewer. ` +
    "A larger site has to keep its files on your own Blossom server."
  );
}

export function isNginxAuthHeaderTooLarge(
  status: number,
  body: string
): boolean {
  return (
    status === 400 && /request header or cookie too large/i.test(body || "")
  );
}

/** Backup copy when nginx still answers, so the popup is not the HTML error page. */
export function nginxAuthHeaderTooLargeMessage(): string {
  return (
    "This page has too many files for one publish on gittr. " +
    "The upload signature is longer than our server accepts. " +
    "Remove files, or keep them on your own Blossom server."
  );
}
