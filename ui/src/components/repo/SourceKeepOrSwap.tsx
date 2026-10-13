"use client";

import { useState } from "react";

import { appAlert } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  NO_SIGNING_METHOD_MESSAGE,
  type ResolvedNostrSigner,
  resolveNostrSigner,
} from "@/lib/nostr/signer";
import {
  type SourceRetargetPatch,
  adoptPublicForge,
  keepNostrGitCopy,
} from "@/lib/repos/apply-source-retarget";
import type { StoredRepo } from "@/lib/repos/storage";
import { isCloneableUpstreamSourceUrl } from "@/lib/utils/detect-git-forge";
import {
  type CloneUrlLiveHint,
  cloneUrlLiveHint,
} from "@/lib/utils/filter-display-clone-urls";

function hostLabel(url: string): string {
  try {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sameGitPlace(a: string, b: string): boolean {
  const norm = (raw: string) =>
    raw
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  return !!norm(a) && norm(a) === norm(b);
}

export function SourceKeepOrSwap(props: {
  entity: string;
  repoName: string;
  ownerPubkey: string;
  sourceUrl: string;
  sourceCleared: boolean;
  repo: StoredRepo | null;
  cloneUrls: string[];
  remoteHeadHints: Record<string, CloneUrlLiveHint>;
  onApplied: (patch: SourceRetargetPatch) => void;
}) {
  const { publish, defaultRelays, remoteSigner } = useNostrContext();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [otherUrl, setOtherUrl] = useState("");

  const forgeSource =
    !!props.sourceUrl && isCloneableUpstreamSourceUrl(props.sourceUrl);
  if (!props.ownerPubkey) return null;
  if (!forgeSource && !props.sourceCleared) return null;

  const copiesWithFiles = props.cloneUrls.filter((url) => {
    const hint = cloneUrlLiveHint(url, { remoteHeads: props.remoteHeadHints });
    return hint === "has-files";
  });
  const forgeChoices = copiesWithFiles.filter(
    (url) =>
      isCloneableUpstreamSourceUrl(url) && !sameGitPlace(url, props.sourceUrl)
  );

  async function run(
    task: (
      signer: ResolvedNostrSigner,
      pub: { publish: NonNullable<typeof publish>; defaultRelays: string[] }
    ) => Promise<{ ok: boolean; message: string; patch?: SourceRetargetPatch }>
  ) {
    if (busy) return;
    if (!props.repo) {
      await appAlert(
        "This page does not have the repo card loaded yet. Refresh, then try again.",
        "Source"
      );
      return;
    }
    if (!publish || !defaultRelays?.length) {
      await appAlert("Sign in as the owner, then try again.", "Source");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const signer = await resolveNostrSigner({ remoteSigner });
      if (!signer) {
        await appAlert(NO_SIGNING_METHOD_MESSAGE, "Source");
        return;
      }
      const result = await task(signer, {
        publish,
        defaultRelays,
      });
      setNote(result.message);
      if (result.patch) props.onApplied(result.patch);
      await appAlert(result.message, result.ok ? "Source updated" : "Stopped");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNote(message);
      await appAlert(message, "Stopped");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-400">
        If this git host is gone
      </summary>
      <div className="space-y-2 pt-2">
        {forgeSource ? (
          <p className="text-xs text-gray-500">
            The addresses under Nostr Backups are what other apps clone. A “has
            files” badge means that address lists commits. It does not mean
            they are the same commits. A typed address is used only when that
            server already has the same ones. Nothing here replaces the repo
            with whatever a new address has now.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            This repo no longer follows the old git host. The commits stay on
            the copies that already have them.
          </p>
        )}
        {copiesWithFiles.length > 0 ? (
          <p className="text-xs text-gray-400">
            Shows commits:{" "}
            {copiesWithFiles.map((url) => hostLabel(url)).join(", ")}
          </p>
        ) : null}
        {forgeSource ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() =>
              run((signer, pub) =>
                keepNostrGitCopy({
                  entity: props.entity,
                  repoName: props.repoName,
                  ownerPubkey: props.ownerPubkey,
                  repo: props.repo as StoredRepo,
                  signer,
                  pub,
                })
              )
            }
          >
            {busy ? "Checking…" : "Keep the Nostr git copy"}
          </Button>
        ) : null}
        {forgeChoices.map((url) => (
          <Button
            key={url}
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() =>
              run((signer, pub) =>
                adoptPublicForge({
                  entity: props.entity,
                  repoName: props.repoName,
                  ownerPubkey: props.ownerPubkey,
                  repo: props.repo as StoredRepo,
                  sourceUrl: url,
                  signer,
                  pub,
                })
              )
            }
          >
            {busy ? "Checking…" : `Use ${hostLabel(url)}`}
          </Button>
        ))}
        <label className="block text-xs text-gray-500">
          Another public forge that already has these commits
          <input
            value={otherUrl}
            onChange={(event) => setOtherUrl(event.target.value)}
            placeholder="https://codeberg.org/you/repo"
            disabled={busy}
            className="mt-1 w-full rounded border border-gray-700 bg-gray-900/70 px-2 py-1.5 text-xs text-gray-100"
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy || !otherUrl.trim()}
          onClick={() =>
            run((signer, pub) =>
              adoptPublicForge({
                entity: props.entity,
                repoName: props.repoName,
                ownerPubkey: props.ownerPubkey,
                repo: props.repo as StoredRepo,
                sourceUrl: otherUrl.trim(),
                signer,
                pub,
              })
            )
          }
        >
          {busy ? "Checking…" : "Check this server"}
        </Button>
        <p className="text-xs text-gray-500">
          If that server does not already have the same commits, nothing is
          fetched.
        </p>
        {note ? <p className="text-xs text-gray-300">{note}</p> : null}
      </div>
    </details>
  );
}
