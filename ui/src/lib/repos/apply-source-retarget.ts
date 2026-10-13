/**
 * Owner actions for a dead forge source.
 * Keep publishes a new card and does not fetch.
 * Adopt fetches only after the other server already has the same branch tips.
 */
import {
  type RepositoryEvent,
  buildUnsignedRepositoryEvent,
} from "@/lib/nostr/events";
import type { ResolvedNostrSigner } from "@/lib/nostr/signer";
import { syncBridgeFromSource } from "@/lib/nostr/sync-bridge-from-source";
import { isCloneableUpstreamSourceUrl } from "@/lib/utils/detect-git-forge";

import { getEventHash } from "nostr-tools";

import {
  persistAdoptedForgeSource,
  persistForgeSourceCleared,
} from "./persist-forge-source-choice";
import {
  type GitRefTip,
  branchTipsHeld,
  forgeAlreadyHasOurTips,
  normalizeGitRefTips,
} from "./source-retarget-plan";
import type { StoredRepo } from "./storage";

export type SourceRetargetPatch = {
  sourceUrl?: string;
  forgeSourceClearedAt?: number;
};

export type SourceRetargetResult = {
  ok: boolean;
  message: string;
  patch?: SourceRetargetPatch;
};

type PublishFns = {
  publish: (event: unknown, relays: string[]) => void;
  defaultRelays: string[];
};

function normGitUrl(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function readBridgeHeads(
  ownerPubkey: string,
  repo: string
): Promise<{ ok: true; heads: GitRefTip[] } | { ok: false; message: string }> {
  const params = new URLSearchParams({
    ownerPubkey,
    repo,
  });
  const res = await fetch(`/api/nostr/repo/refs?${params.toString()}`);
  if (res.status === 404) return { ok: true, heads: [] };
  if (!res.ok) {
    return {
      ok: false,
      message: "Could not read the commits on gittr. Nothing was changed.",
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    refs?: GitRefTip[];
  };
  return { ok: true, heads: normalizeGitRefTips(json.refs || []) };
}

async function readRemoteHeads(
  url: string
): Promise<{ ok: true; heads: GitRefTip[] } | { ok: false; message: string }> {
  const res = await fetch("/api/git/remote-heads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    heads?: GitRefTip[];
    message?: string;
  };
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message:
        json.message ||
        "That address could not be checked. Nothing was fetched.",
    };
  }
  return { ok: true, heads: normalizeGitRefTips(json.heads || []) };
}

function cardFromRepo(
  repo: StoredRepo,
  repoName: string,
  opts: { omitForgeSource: boolean; sourceUrl?: string }
): RepositoryEvent {
  const dropped = normGitUrl(repo.sourceUrl);
  const fork = typeof repo.forkedFrom === "string" ? repo.forkedFrom : "";
  const keepFork = fork && normGitUrl(fork) !== dropped ? fork : undefined;
  const payload: RepositoryEvent = {
    repositoryName: repoName,
    name: repo.name || repo.repositoryName || repoName,
    publicRead: repo.publicRead !== false,
    publicWrite: false,
    description: repo.description,
    tags: Array.isArray(repo.topics) ? repo.topics : undefined,
    topics: Array.isArray(repo.topics) ? repo.topics : undefined,
    clone: Array.isArray(repo.clone) ? [...repo.clone] : [],
    relays: Array.isArray(repo.relays) ? [...repo.relays] : [],
    links: Array.isArray(repo.links) ? [...repo.links] : undefined,
    contributors: Array.isArray(repo.contributors)
      ? repo.contributors.map((person) => ({
          pubkey: person.pubkey,
          name: person.name,
          picture: person.picture,
          weight: person.weight ?? 0,
          githubLogin: person.githubLogin,
        }))
      : undefined,
    sourceUrl: opts.omitForgeSource ? undefined : opts.sourceUrl,
    forkedFrom: opts.omitForgeSource ? keepFork : repo.forkedFrom,
    omitForgeSource: opts.omitForgeSource || undefined,
    pushCostSats: repo.pushCostSats,
    defaultBranch: repo.defaultBranch,
  };
  const extra = repo as StoredRepo & {
    announcedAppId?: string;
    logoUrl?: string;
    requiredApprovals?: number;
    zapPolicy?: RepositoryEvent["zapPolicy"];
  };
  if (extra.announcedAppId) {
    (payload as RepositoryEvent & { announcedAppId?: string }).announcedAppId =
      extra.announcedAppId;
  }
  if (extra.logoUrl) payload.logoUrl = extra.logoUrl;
  if (typeof extra.requiredApprovals === "number") {
    (
      payload as RepositoryEvent & { requiredApprovals?: number }
    ).requiredApprovals = extra.requiredApprovals;
  }
  if (extra.zapPolicy) payload.zapPolicy = extra.zapPolicy;
  return payload;
}

async function signAndPublish(opts: {
  card: RepositoryEvent;
  signer: ResolvedNostrSigner;
  pub: PublishFns;
  ownerPubkey: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const pubkeyHex = (
    (await opts.signer.getPublicKey()) ||
    opts.ownerPubkey ||
    ""
  ).toLowerCase();
  if (!pubkeyHex || pubkeyHex !== opts.ownerPubkey.toLowerCase()) {
    return {
      ok: false,
      message: "Sign in as the repo owner. Nothing was changed.",
    };
  }
  const cloneCount = Array.isArray(opts.card.clone)
    ? opts.card.clone.length
    : 0;
  if (!opts.card.repositoryName || cloneCount === 0) {
    return {
      ok: false,
      message:
        "This page does not have the repo card loaded yet. Refresh, then try again. Nothing was changed.",
    };
  }
  const unsigned = buildUnsignedRepositoryEvent(opts.card, pubkeyHex);
  unsigned.id = getEventHash(unsigned);
  const signBudgetMs = opts.signer.source === "remote" ? 180000 : 120000;
  let signed: { sig?: string };
  try {
    signed = await Promise.race([
      opts.signer.signEvent(unsigned),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Signing timed out")), signBudgetMs)
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message || "Signing was cancelled. Nothing was changed.",
    };
  }
  if (!signed?.sig) {
    return {
      ok: false,
      message: "The card was not signed. Nothing was changed.",
    };
  }
  try {
    opts.pub.publish(signed, opts.pub.defaultRelays);
  } catch (error) {
    console.warn("[source-retarget] relay publish failed:", error);
    return {
      ok: false,
      message: "The card was signed but could not be sent. Try again.",
    };
  }
  try {
    await fetch("/api/nostr/repo/push-policy-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nostr-Auth-Event": utf8ToBase64Json(signed),
      },
    });
  } catch {
    /* the card is already published; paywall sync can be saved again in Settings */
  }
  return { ok: true };
}

function utf8ToBase64Json(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function keepNostrGitCopy(opts: {
  entity: string;
  repoName: string;
  ownerPubkey: string;
  repo: StoredRepo;
  signer: ResolvedNostrSigner;
  pub: PublishFns;
}): Promise<SourceRetargetResult> {
  const first = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!first.ok) return { ok: false, message: first.message };
  if (first.heads.length === 0) {
    return {
      ok: false,
      message:
        "gittr does not have the commits for this repo yet. Nothing was changed.",
    };
  }
  const second = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!second.ok) return { ok: false, message: second.message };
  if (!branchTipsHeld(first.heads, second.heads)) {
    return {
      ok: false,
      message:
        "The commits moved while they were being checked. Nothing was changed.",
    };
  }

  const published = await signAndPublish({
    card: cardFromRepo(opts.repo, opts.repoName, { omitForgeSource: true }),
    signer: opts.signer,
    pub: opts.pub,
    ownerPubkey: opts.ownerPubkey,
  });
  if (!published.ok) return { ok: false, message: published.message };

  const clearedAt = Math.floor(Date.now() / 1000);
  persistForgeSourceCleared({
    entity: opts.entity,
    repo: opts.repoName,
    clearedAt,
    previousSourceUrl: opts.repo.sourceUrl,
  });

  const after = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!after.ok || !branchTipsHeld(first.heads, after.heads)) {
    return {
      ok: true,
      message:
        "gittr stopped asking the old host. The commits changed while that was saved. Look at them before you continue. Nothing was fetched.",
      patch: { forgeSourceClearedAt: clearedAt },
    };
  }
  return {
    ok: true,
    message:
      "gittr stopped asking the old host. The commits were left where they are. New issues and pull requests stay on Nostr.",
    patch: { forgeSourceClearedAt: clearedAt },
  };
}

export async function adoptPublicForge(opts: {
  entity: string;
  repoName: string;
  ownerPubkey: string;
  repo: StoredRepo;
  sourceUrl: string;
  signer: ResolvedNostrSigner;
  pub: PublishFns;
}): Promise<SourceRetargetResult> {
  const sourceUrl = opts.sourceUrl.trim().replace(/\.git$/i, "");
  if (!sourceUrl || !isCloneableUpstreamSourceUrl(sourceUrl)) {
    return {
      ok: false,
      message:
        "That address is not a public git host gittr can follow. Nothing was fetched. To stop asking the old host, use “Keep the Nostr git copy”.",
    };
  }

  const before = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!before.ok) return { ok: false, message: before.message };
  const remote = await readRemoteHeads(sourceUrl);
  if (!remote.ok) return { ok: false, message: remote.message };
  const match = forgeAlreadyHasOurTips(before.heads, remote.heads);
  if (!match.ok) return { ok: false, message: match.message };

  const stable = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!stable.ok) return { ok: false, message: stable.message };
  if (!branchTipsHeld(before.heads, stable.heads)) {
    return {
      ok: false,
      message:
        "The commits moved while they were being checked. Nothing was fetched.",
    };
  }

  const pubkeyHex = (
    (await opts.signer.getPublicKey()) ||
    opts.ownerPubkey ||
    ""
  ).toLowerCase();
  if (!pubkeyHex || pubkeyHex !== opts.ownerPubkey.toLowerCase()) {
    return {
      ok: false,
      message: "Sign in as the repo owner. Nothing was fetched.",
    };
  }

  const synced = await syncBridgeFromSource({
    ownerPubkey: opts.ownerPubkey,
    repo: opts.repoName,
    sourceUrl,
    pubkey: pubkeyHex,
    signer: opts.signer.signEvent,
  });
  if (!synced.success) {
    return {
      ok: false,
      message:
        synced.error ||
        "The copy from that server did not finish. The source line was not changed.",
    };
  }

  const afterFetch = await readBridgeHeads(opts.ownerPubkey, opts.repoName);
  if (!afterFetch.ok || !branchTipsHeld(before.heads, afterFetch.heads)) {
    return {
      ok: false,
      message:
        "That copy changed the commits. The source line was not changed. Look at the commits before you try again.",
    };
  }

  const published = await signAndPublish({
    card: cardFromRepo(opts.repo, opts.repoName, {
      omitForgeSource: false,
      sourceUrl,
    }),
    signer: opts.signer,
    pub: opts.pub,
    ownerPubkey: opts.ownerPubkey,
  });
  if (!published.ok) return { ok: false, message: published.message };

  persistAdoptedForgeSource({
    entity: opts.entity,
    repo: opts.repoName,
    sourceUrl,
  });
  return {
    ok: true,
    message:
      "The source now points at that server. It already had the same commits, so the copy was a match.",
    patch: { sourceUrl },
  };
}
