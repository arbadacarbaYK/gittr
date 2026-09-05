/**
 * Optional pin of hashed NIP-82 assets onto public Blossom hosts.
 * Failures are warnings — announce still uses forge download URLs.
 */
import type { Event as NostrEvent, UnsignedEvent } from "nostr-tools";

import type { ForgeReleasesOk } from "../repo/forge-releases";

import { unsignedNgitBlossomUploadAuth } from "./blossom-bud11-auth";
import {
  allowedNip82BlossomAssetUrl,
  ngitBlossomHostnames,
} from "./nip82-blossom-hosts";
import {
  pickAnnouncePrimaryAsset,
  pickSiblingNip82Assets,
} from "./software-announce-build";

export type PinBlossomAsset = {
  downloadUrl: string;
  sha256: string;
  name: string;
};

export type PinReleaseAssetsResult = {
  overrides: Record<string, string>;
  warnings: string[];
};

export function hashedAssetsForNgitBlossomPin(
  forge: ForgeReleasesOk,
  selectedUrl?: string
): PinBlossomAsset[] {
  const primary = pickAnnouncePrimaryAsset(forge, selectedUrl);
  const extras = pickSiblingNip82Assets(forge, primary);
  const out: PinBlossomAsset[] = [];
  for (const a of [primary, ...extras]) {
    const sha = (a.sha256 || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) continue;
    out.push({ downloadUrl: a.downloadUrl, sha256: sha, name: a.name });
  }
  return out;
}

export async function pinReleaseAssetsToNgitBlossom(args: {
  sourceUrl: string;
  tag?: string | null;
  forge: ForgeReleasesOk;
  selectedUrl?: string;
  ownerPubkeyHex: string;
  signEvent: (event: UnsignedEvent) => Promise<NostrEvent>;
}): Promise<PinReleaseAssetsResult> {
  const assets = hashedAssetsForNgitBlossomPin(args.forge, args.selectedUrl);
  const warnings: string[] = [];
  const overrides: Record<string, string> = {};
  if (assets.length === 0) {
    return {
      overrides,
      warnings: ["No hashed installers to pin — using forge download URLs."],
    };
  }

  const unsigned = unsignedNgitBlossomUploadAuth({
    pubkeyHex: args.ownerPubkeyHex,
    sha256Hex: assets.map((a) => a.sha256),
    serverHostnames: ngitBlossomHostnames(),
  });
  const authEvent = await args.signEvent(unsigned as UnsignedEvent);

  for (const asset of assets) {
    try {
      const res = await fetch("/api/repo/forge-release-blossom-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: args.sourceUrl,
          tag: args.tag || undefined,
          downloadUrl: asset.downloadUrl,
          sha256: asset.sha256,
          authEvent,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!data.ok || !data.url) {
        warnings.push(
          `${asset.name}: ${
            data.error || "pin failed"
          } — keeping the forge URL.`
        );
        continue;
      }
      const allowed = allowedNip82BlossomAssetUrl(data.url);
      if (!allowed) {
        warnings.push(
          `${asset.name}: Blossom returned a URL we will not use — keeping the forge URL.`
        );
        continue;
      }
      overrides[asset.downloadUrl] = allowed;
    } catch (e) {
      const message = e instanceof Error ? e.message : "pin failed";
      warnings.push(`${asset.name}: ${message} — keeping the forge URL.`);
    }
  }

  return { overrides, warnings };
}
