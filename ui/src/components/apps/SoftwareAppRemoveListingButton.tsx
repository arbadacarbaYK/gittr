"use client";

import { useState } from "react";

import { appAlert, appConfirm } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { deleteSoftwareAnnounceForAppId } from "@/lib/nostr/delete-repo-related-nostr";
import { resolveNostrSigner } from "@/lib/nostr/signer";

type SoftwareAppRemoveListingButtonProps = {
  appId: string;
  appName?: string;
  ownerPubkeyHex: string;
  onRemoved?: (appId: string) => void;
};

export function SoftwareAppRemoveListingButton({
  appId,
  appName,
  ownerPubkeyHex,
  onRemoved,
}: SoftwareAppRemoveListingButtonProps) {
  const { publish, subscribe, defaultRelays, remoteSigner, pubkey } =
    useNostrContext();
  const [busy, setBusy] = useState(false);
  const session = (pubkey || "").toLowerCase();
  const owner = ownerPubkeyHex.toLowerCase();
  if (!session || session !== owner) return null;

  const remove = async () => {
    const label = appName?.trim() ? `${appName} (${appId})` : appId;
    const ok = await appConfirm(
      `Remove the Nostr listing “${label}”?\n\nThis sends a delete request (NIP-09) for that app id only. The git repo stays. The APK file on GitHub or Blossom is not deleted — other listings that use the same file keep working.`,
      "Remove listing"
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteSoftwareAnnounceForAppId({
        ownerPubkeyHex: owner,
        appId,
        defaultRelays: defaultRelays || [],
        subscribe: subscribe as any,
        publish: publish as any,
        resolveSigner: () =>
          resolveNostrSigner({ remoteSigner, waitForRemote: true }),
      });
      onRemoved?.(appId);
    } catch (e) {
      await appAlert(
        e instanceof Error ? e.message : "Could not remove this listing."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => void remove()}
    >
      {busy ? "Removing…" : "Remove listing"}
    </Button>
  );
}
