/**
 * Intentional local draft for upload/push/display.
 *
 * Primary signal is `hasUnpushedEdits`. The date heuristic recovers false-clean
 * rows where edits bumped `lastModifiedAt` but the flag was cleared. Do **not**
 * invent tip-vs-local date races for Push — Refresh / clean tip-sync / this
 * flag are the write gates.
 */
export function repoHasUnpushedLocalEdits(repo: any): boolean {
  if (!repo || typeof repo !== "object") return false;
  if (repo.hasUnpushedEdits === true) return true;
  return !!(
    repo.lastNostrEventId &&
    repo.lastModifiedAt &&
    repo.lastNostrEventCreatedAt &&
    repo.lastModifiedAt > repo.lastNostrEventCreatedAt * 1000
  );
}
