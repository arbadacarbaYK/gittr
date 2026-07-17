/**
 * Repair NIP-34 announces whose clone tags are all unusable
 * (host-only git.gittr.space, localhost, private LAN, etc.).
 * Requires the owner's signer — we cannot forge kind 30617.
 * Supports nsec, NIP-07, and remote signing via pushRepoToNostr.
 */
import {
  isHostOnlyCloneUrl,
  collectCloneUrlsFromTags,
  shouldHideAnnounceForUnusableClones,
} from "@/lib/nostr/clone-url-quality";
import {
  pushRepoToNostr,
  type PushRepoOptions,
  type PushRepoResult,
} from "@/lib/nostr/push-repo-to-nostr";

/** @deprecated Prefer cloneListNeedsRepublish — kept for call-site clarity. */
export function announceHasOnlyHostOnlyClones(tags: unknown[]): boolean {
  const clones = collectCloneUrlsFromTags(tags);
  if (clones.length === 0) return false;
  return clones.every((u) => isHostOnlyCloneUrl(u));
}

/**
 * True when the announce lists clone URL(s) but none are usable for other
 * clients (same rule as homepage/explore hide). Owner should Push to Nostr again.
 */
export function cloneListNeedsRepublish(
  cloneUrls: string[] | undefined | null
): boolean {
  return shouldHideAnnounceForUnusableClones(cloneUrls);
}

/** @deprecated Use cloneListNeedsRepublish */
export function cloneListNeedsHostOnlyRepair(
  cloneUrls: string[] | undefined | null
): boolean {
  return cloneListNeedsRepublish(cloneUrls);
}

export const CLONE_REPUBLISH_BADGE_LABEL = "Please republish";

export const CLONE_REPUBLISH_BADGE_TITLE =
  "Clone URL is only a bare host, localhost, or other unusable address. Push to Nostr again so gitworkshop and others can load files.";

/**
 * Re-publish each repo so clone tags become full usable paths
 * (e.g. https://git…/<npub>/<repo>.git). One Push per repo — may need
 * multiple signature approvals (nsec / extension / remote signer).
 */
export async function repairHostOnlyCloneAnnounces(opts: {
  repoSlugs: Array<{ entity: string; repoSlug: string }>;
  publish: PushRepoOptions["publish"];
  subscribe: PushRepoOptions["subscribe"];
  defaultRelays: string[];
  pubkey: string;
  remoteSigner?: PushRepoOptions["remoteSigner"];
  privateKey?: string;
  onProgress?: (msg: string) => void;
}): Promise<{
  repaired: string[];
  failed: Array<{ repo: string; error: string }>;
}> {
  const repaired: string[] = [];
  const failed: Array<{ repo: string; error: string }> = [];
  const total = opts.repoSlugs.length;

  for (let i = 0; i < opts.repoSlugs.length; i++) {
    const t = opts.repoSlugs[i];
    if (!t) continue;
    const repoName = (t.repoSlug || "").trim();
    if (!repoName) continue;
    opts.onProgress?.(
      `Republishing ${repoName} (${i + 1}/${total}) — approve signatures if asked…`
    );
    try {
      const result: PushRepoResult = await pushRepoToNostr({
        entity: t.entity,
        repoSlug: repoName,
        publish: opts.publish,
        subscribe: opts.subscribe,
        defaultRelays: opts.defaultRelays,
        pubkey: opts.pubkey,
        remoteSigner: opts.remoteSigner,
        privateKey: opts.privateKey,
        onProgress: opts.onProgress,
      });
      if (!result.success) {
        failed.push({
          repo: repoName,
          error: result.error || "push failed",
        });
      } else {
        repaired.push(repoName);
      }
    } catch (e: any) {
      failed.push({
        repo: repoName,
        error: e?.message || String(e),
      });
    }
  }

  return { repaired, failed };
}
