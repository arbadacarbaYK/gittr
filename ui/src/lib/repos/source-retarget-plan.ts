/**
 * Guards for changing a repo's forge `source` without replacing the only copy.
 *
 * Keep: publish a new card, do not fetch.
 * Adopt: another public forge already has the same branch tips, then fetch.
 * Anything else: stop. No fetch.
 */

export type GitRefTip = { ref: string; commit: string };

export function normalizeGitRefTips(rows: GitRefTip[]): GitRefTip[] {
  const out: GitRefTip[] = [];
  for (const row of rows || []) {
    const ref = String(row?.ref || "").trim();
    const commit = String(row?.commit || "")
      .trim()
      .toLowerCase();
    if (!ref.startsWith("refs/heads/")) continue;
    if (!/^[0-9a-f]{40,64}$/.test(commit)) continue;
    out.push({ ref, commit });
  }
  return out;
}

/** Every branch we already had is still the same commit. Extra branches are fine. */
export function branchTipsHeld(
  before: GitRefTip[],
  after: GitRefTip[]
): boolean {
  const prior = normalizeGitRefTips(before);
  const next = new Map(
    normalizeGitRefTips(after).map((row) => [row.ref, row.commit])
  );
  return prior.every((row) => next.get(row.ref) === row.commit);
}

export function forgeAlreadyHasOurTips(
  bridgeHeads: GitRefTip[],
  remoteHeads: GitRefTip[]
): { ok: true } | { ok: false; message: string } {
  const bridge = normalizeGitRefTips(bridgeHeads);
  const remote = new Map(
    normalizeGitRefTips(remoteHeads).map((row) => [row.ref, row.commit])
  );

  if (bridge.length === 0) {
    return {
      ok: false,
      message:
        "gittr does not have the commits for this repo yet, so there is nothing to match. Nothing was fetched.",
    };
  }
  if (remote.size === 0) {
    return {
      ok: false,
      message:
        "That address has no commits. Fetching it would replace the only copy. Nothing was fetched.",
    };
  }

  const missing: string[] = [];
  const moved: string[] = [];
  for (const row of bridge) {
    const name = row.ref.replace(/^refs\/heads\//, "");
    const sha = remote.get(row.ref);
    if (!sha) missing.push(name);
    else if (sha !== row.commit) moved.push(name);
  }
  if (missing.length > 0 || moved.length > 0) {
    return {
      ok: false,
      message:
        "That server does not already have the same commits as gittr. Nothing was fetched. Push the gittr copy to that server first, then try again.",
    };
  }
  return { ok: true };
}
