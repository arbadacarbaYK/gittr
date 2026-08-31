export type PushRepoSuccessAlertInput = {
  eventId?: string;
  stateEventId?: string;
  confirmed: boolean;
  excludedFromPush?: string[];
};

/** Shared success/partial popup copy for repo page and My Repositories. */
export function formatPushRepoSuccessAlert(
  result: PushRepoSuccessAlertInput
): string {
  const announcementId = result.eventId?.slice(0, 16) || "unknown";
  const excluded = (result.excludedFromPush || []).filter(Boolean);
  const excludedNote =
    excluded.length > 0
      ? `\n\n⚠️ ${
          excluded.length
        } path(s) were not pushed (no file bytes in this browser, and upstream returned 404). Other clients will not see them until you re-import or upload content:\n${excluded
          .slice(0, 12)
          .map((p) => `• ${p}`)
          .join("\n")}${
          excluded.length > 12 ? `\n• …and ${excluded.length - 12} more` : ""
        }`
      : "";
  if (result.confirmed && result.stateEventId) {
    const stateId = result.stateEventId.slice(0, 16) || "unknown";
    const headline = excluded.length
      ? `⚠️ Repository announced on Nostr, but some files were skipped.`
      : `✅ Repository pushed to Nostr!`;
    return (
      `${headline}\n\n` +
      `✅ Announcement event (30617): ${announcementId}...\n` +
      `✅ State event (30618): ${stateId}...\n\n` +
      `Both events published and confirmed.` +
      excludedNote +
      `\n\nNote: older PR/issue events on relays are still there unchanged. If you changed files before this push, reopen Nostr PRs in gittr to be sure they still match the repo you just published.`
    );
  }
  if (result.stateEventId) {
    const stateId = result.stateEventId.slice(0, 16) || "unknown";
    return (
      `⚠️ Repository published but awaiting confirmation.\n\n` +
      `✅ Announcement event (30617): ${announcementId}...\n` +
      `✅ State event (30618): ${stateId}...\n\n` +
      `Both events published - confirmation may take a few moments.` +
      excludedNote +
      `\n\nNote: older PR/issue events on relays are unchanged—reopen Nostr PRs if file changes might make them stale.`
    );
  }
  return (
    `⚠️ Repository partially published.\n\n` +
    `Event ID: ${announcementId}...\n\n` +
    `Second signature may not have completed. Please try pushing again.` +
    excludedNote
  );
}
