/**
 * Heal local-only deletes: `gittr_deleted_repos` hid repos in the browser but
 * Settings historically navigated away before the signer finished, so relays still
 * have a live kind 30617. Call from My Repos when the owner is signed in.
 *
 * Do not prompt just because a hidden name still appears in profile-repos — leftover
 * 30618 state or an older live 30617 is not “delete never finished signing”.
 */
import { appAlert, appConfirm } from "@/components/ui/app-dialog";
import { publishRepoSoftDelete } from "@/lib/nostr/publish-repo-soft-delete";
import type { ResolvedNostrSigner } from "@/lib/nostr/signer";
import {
  type DeletedRepoTombstone,
  type LiveHealRepo,
  liveReposThatNeedSoftDeleteHeal,
} from "@/lib/repos/deleted-repo-tombstones";

const SESSION_KEY = "gittr_soft_delete_heal_prompted";

function readLocalTombstones(): DeletedRepoTombstone[] {
  try {
    const raw = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as DeletedRepoTombstone[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function tombstoneOwnedBy(
  d: DeletedRepoTombstone,
  ownerPubkey: string
): boolean {
  const owner = ownerPubkey.toLowerCase();
  if ((d.ownerPubkey || "").toLowerCase() === owner) return true;
  const ent = (d.entity || "").trim().toLowerCase();
  if (ent === owner) return true;
  return false;
}

export async function healLocalSoftDeletesIfNeeded(opts: {
  ownerPubkey: string;
  liveRepoNames?: string[];
  liveRepos?: LiveHealRepo[];
  signer: ResolvedNostrSigner;
  publish: (event: any, relays: string[]) => void;
  defaultRelays: string[];
  force?: boolean;
  forceNames?: string[];
  forceEvenIfNotLive?: boolean;
}): Promise<{ attempted: number; ok: number; failed: string[] }> {
  if (typeof window === "undefined") {
    return { attempted: 0, ok: 0, failed: [] };
  }
  const owner = (opts.ownerPubkey || "").toLowerCase();
  if (!owner || !/^[0-9a-f]{64}$/.test(owner)) {
    return { attempted: 0, ok: 0, failed: [] };
  }
  if (
    !opts.force &&
    !opts.forceNames?.length &&
    sessionStorage.getItem(SESSION_KEY) === "1"
  ) {
    return { attempted: 0, ok: 0, failed: [] };
  }

  const liveRepos: LiveHealRepo[] = (opts.liveRepos || []).concat(
    (opts.liveRepoNames || []).map((n) => ({ repo: n }))
  );
  const live = new Set(
    liveRepos
      .map((r) => (r.repo || r.name || "").trim().toLowerCase())
      .filter(Boolean)
  );

  let unique: string[];
  if (opts.forceNames && opts.forceNames.length > 0) {
    unique = [
      ...new Set(
        opts.forceNames
          .map((n) => n.trim().toLowerCase())
          .filter((name) => name && (opts.forceEvenIfNotLive || live.has(name)))
      ),
    ];
  } else {
    unique = liveReposThatNeedSoftDeleteHeal(
      owner,
      liveRepos,
      readLocalTombstones().filter((d) => tombstoneOwnedBy(d, owner))
    );
  }

  if (unique.length === 0) {
    return { attempted: 0, ok: 0, failed: [] };
  }

  if (!opts.forceNames?.length) {
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  const okConfirm = await appConfirm(
    `${unique.length} repo(s) have a live announcement newer than your last delete.\n\n` +
      `Publish another soft-delete?\n\n${unique.slice(0, 12).join(", ")}${
        unique.length > 12 ? ", …" : ""
      }\n\nAmber / your extension may ask once per repo. Cancel will not ask again this session.`,
    "Repos still on Nostr"
  );
  if (!okConfirm) {
    return { attempted: 0, ok: 0, failed: [] };
  }

  if (!opts.publish || !opts.signer) {
    await appAlert(
      "Sign in with Amber, NIP-07, or a key to publish soft-deletes.",
      "Cannot publish"
    );
    return { attempted: 0, ok: 0, failed: unique };
  }

  let ok = 0;
  const failed: string[] = [];
  for (const name of unique) {
    try {
      await publishRepoSoftDelete({
        repo: { repoName: name },
        signer: opts.signer,
        pub: {
          publish: opts.publish,
          defaultRelays: opts.defaultRelays || [],
          pubkey: owner,
        },
      });
      ok++;
    } catch (e: any) {
      console.error("[heal soft-delete]", name, e);
      failed.push(`${name}: ${e?.message || e}`);
    }
  }

  if (failed.length) {
    await appAlert(
      `Published ${ok}/${unique.length}. Failed:\n${failed
        .slice(0, 8)
        .join("\n")}`,
      "Soft-delete"
    );
  } else if (ok > 0) {
    await appAlert(
      `Published soft-deletes for ${ok} repo(s). Bridge wipe requested.`,
      "Soft-delete"
    );
  }

  return { attempted: unique.length, ok, failed };
}
