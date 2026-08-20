export type AnnouncementCloneStatus = "unknown" | "empty" | "present";

/**
 * Guess well-known GRASP HTTPS paths only when the kind 30617 for this repo
 * arrived and really had no clone tags. If the announcement is still in flight,
 * do not invent git.gittr.space / ngit — that races real clone tags (e.g. a
 * self-hosted git remote on the event).
 */
export function shouldInferGraspCloneUrls(args: {
  collectedCloneCount: number;
  announcementStatus: AnnouncementCloneStatus;
  allowLastResort?: boolean;
}): boolean {
  if (args.collectedCloneCount > 0) return false;
  if (args.announcementStatus === "present") return false;
  if (args.announcementStatus === "empty") return true;
  return args.allowLastResort === true;
}

export function announcementCloneStatusFromEvent(cloneTags: unknown): {
  sawAnnouncement: true;
  status: Exclude<AnnouncementCloneStatus, "unknown">;
} {
  const clones = Array.isArray(cloneTags)
    ? cloneTags.filter((u) => typeof u === "string" && u.trim().length > 0)
    : [];
  return {
    sawAnnouncement: true,
    status: clones.length > 0 ? "present" : "empty",
  };
}
