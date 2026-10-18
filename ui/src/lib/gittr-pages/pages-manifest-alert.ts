export type PagesManifestSuccessAlertInput = {
  manifestEventId?: string;
  pathCount: number;
  confirmed: boolean;
  namedUrl: string;
  serverListEventId?: string;
  serverListConfirmed?: boolean;
  /** Gateway ingest found the 35128. Null/undefined = ingest did not answer. */
  ingestFound?: boolean | null;
  /** Event id the gateway is actually serving for this page name. */
  ingestEventId?: string | null;
};

export function formatPagesManifestErrorAlert(message: string): string {
  const body = (message || "").trim() || "Unknown error";
  return `❌ Manifest publish failed.\n\n${body}`;
}

/**
 * Same emoji language as the repo-push popup. Say so when /pages may still
 * need a moment — ingest is usually seconds, not the old 10-minute sync.
 */
export function formatPagesManifestSuccessAlert(
  result: PagesManifestSuccessAlertInput
): string {
  const eventId = result.manifestEventId?.trim() || "unknown";
  const liveUrl = result.namedUrl.trim();
  const ingestFound = result.ingestFound;
  const publishedId = result.manifestEventId?.trim().toLowerCase() || "";
  const directoryId = result.ingestEventId?.trim().toLowerCase() || "";
  const directoryHasThisVersion =
    ingestFound === true &&
    (!publishedId || !directoryId || publishedId === directoryId);
  const directoryKeptOlder =
    ingestFound === true &&
    !!publishedId &&
    !!directoryId &&
    publishedId !== directoryId;
  let headline: string;
  let wait = "";
  if (result.confirmed && directoryHasThisVersion) {
    headline = "✅ Pages live.";
  } else if (result.confirmed && directoryKeptOlder) {
    headline = "⚠️ Pages manifest published. The directory still has the previous version.";
    wait =
      "\n\nThe relay that fills /pages did not keep this publish. Push the manifest once more.";
  } else if (result.confirmed && ingestFound === false) {
    headline =
      "⚠️ Pages manifest published. The directory is still catching up.";
    wait =
      "\n\nThis is usually a few seconds — not a 10-minute wait. Refresh /pages or this repo’s Links shortly.";
  } else if (!result.confirmed) {
    headline = "⚠️ Pages manifest published but awaiting relay confirmation.";
    wait = "\n\nRelays may need a moment. Then /pages will list the site.";
  } else {
    headline = "✅ Pages manifest published.";
    wait =
      "\n\nIf /pages does not show it yet, wait a few seconds and refresh.";
  }

  const serverListLine = result.serverListEventId
    ? `\nBlossom server list (kind 10063): ${
        result.serverListEventId
      }\nServer-list relay confirmation: ${
        result.serverListConfirmed
          ? "yes"
          : "pending — relays may need a moment"
      }`
    : "";

  return (
    `${headline}\n\n` +
    `Event id:\n${eventId}\n\n` +
    `Files in manifest: ${result.pathCount}\n` +
    `Relay confirmation: ${
      result.confirmed ? "yes" : "pending"
    }${serverListLine}\n\n` +
    `Live URL:\n${liveUrl}` +
    wait
  );
}
