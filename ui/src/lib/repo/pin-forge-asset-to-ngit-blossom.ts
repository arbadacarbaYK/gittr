/**
 * Stream a public forge Release asset to allowlisted public Blossom hosts.
 * Bytes are never written to gittr disk or blossom.gittr.space.
 */
import { createHash } from "crypto";

import { inspectBlossomUploadAuth } from "../nostr/blossom-bud11-auth";
import {
  NGIT_BLOSSOM_ORIGINS,
  isGittrBlossomHostname,
  resolvePinnedBlossomUrl,
} from "../nostr/nip82-blossom-hosts";

import {
  FORGE_ASSET_HASH_MAX_BYTES,
  announceableForgeAssets,
  fetchForgeReleasesForAnnounce,
  forgeAssetDownloadHeaders,
} from "./forge-releases";

const ATTEMPT_TIMEOUT_MS = 90_000;

export type PinForgeAssetResult =
  | {
      ok: true;
      url: string;
      host: string;
      reused: boolean;
    }
  | { ok: false; error: string; code: string };

function nostrBlossomAuthorizationHeaders(event: object): string[] {
  const json = JSON.stringify(event);
  const padded = Buffer.from(json, "utf8").toString("base64");
  const url = padded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const headers = [`Nostr ${url}`];
  if (padded !== url) headers.push(`Nostr ${padded}`);
  return headers;
}

function hashAndLimitStream(
  source: ReadableStream<Uint8Array>,
  expectedSha: string,
  maxBytes: number
): ReadableStream<Uint8Array> {
  const hash = createHash("sha256");
  const reader = source.getReader();
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        const got = hash.digest("hex");
        if (got !== expectedSha) {
          controller.error(
            new Error("File sha256 does not match the verified hash")
          );
          return;
        }
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new Error("File exceeds maximum pin size"));
        return;
      }
      hash.update(value);
      controller.enqueue(value);
    },
    cancel() {
      return reader.cancel();
    },
  });
}

async function blossomHeadExists(
  origin: string,
  sha256: string,
  signal: AbortSignal
): Promise<boolean> {
  const url = `${origin.replace(/\/$/, "")}/${sha256}`;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function parseDescriptorUrl(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { url?: unknown };
    return typeof parsed.url === "string" ? parsed.url : undefined;
  } catch {
    return undefined;
  }
}

async function openForgeDownload(
  downloadUrl: string,
  sha256: string,
  signal: AbortSignal
): Promise<{
  body: ReadableStream<Uint8Array>;
  contentType: string;
} | null> {
  const res = await fetch(downloadUrl, {
    signal,
    redirect: "follow",
    headers: forgeAssetDownloadHeaders(downloadUrl),
  });
  if (!res.ok || !res.body) return null;
  const mime = res.headers.get("content-type") || "application/octet-stream";
  const mimeHead = (mime.split(";")[0] || "application/octet-stream").trim();
  return {
    body: hashAndLimitStream(res.body, sha256, FORGE_ASSET_HASH_MAX_BYTES),
    contentType: mimeHead || "application/octet-stream",
  };
}

async function putOnce(args: {
  origin: string;
  sha256: string;
  authorization: string;
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  signal: AbortSignal;
}): Promise<{ ok: true; url: string } | { ok: false; status: number }> {
  const uploadUrl = `${args.origin.replace(/\/$/, "")}/upload`;
  const headers: Record<string, string> = {
    Authorization: args.authorization,
    "X-SHA-256": args.sha256,
    "Content-Type": args.contentType || "application/octet-stream",
  };
  if (args.contentLength && args.contentLength > 0) {
    headers["Content-Length"] = String(args.contentLength);
  }
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      signal: args.signal,
      headers,
      body: args.body,
      duplex: "half",
    } as RequestInit);
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text().catch(() => "");
  const url = resolvePinnedBlossomUrl({
    putOrigin: args.origin,
    sha256Hex: args.sha256,
    descriptorUrl: parseDescriptorUrl(text),
  });
  if (!url) return { ok: false, status: res.status };
  return { ok: true, url };
}

export async function pinForgeReleaseAssetToNgitBlossom(args: {
  sourceUrl: string;
  tag?: string | null;
  downloadUrl: string;
  sha256: string;
  authEvent: unknown;
}): Promise<PinForgeAssetResult> {
  const sha256 = args.sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return {
      ok: false,
      code: "invalid_request",
      error: "sha256 must be 64 hex chars",
    };
  }

  const authShape = inspectBlossomUploadAuth(args.authEvent, sha256);
  if (!authShape.ok) {
    return { ok: false, code: "invalid_auth", error: authShape.error };
  }

  const { validateEvent, verifySignature } = await import("nostr-tools");
  const ev = args.authEvent as import("nostr-tools").Event;
  if (!validateEvent(ev) || !verifySignature(ev)) {
    return {
      ok: false,
      code: "invalid_auth",
      error: "authEvent signature invalid",
    };
  }

  const forge = await fetchForgeReleasesForAnnounce({
    sourceUrl: args.sourceUrl,
    tag: args.tag,
    includeHash: false,
  });
  if (!forge.ok) {
    return { ok: false, code: forge.code, error: forge.message };
  }

  const asset = announceableForgeAssets(forge.release.assets).find(
    (a) => a.downloadUrl === args.downloadUrl
  );
  if (!asset) {
    return {
      ok: false,
      code: "invalid_request",
      error: "downloadUrl is not an announceable asset on that forge Release",
    };
  }
  if (asset.size > FORGE_ASSET_HASH_MAX_BYTES) {
    return {
      ok: false,
      code: "too_large",
      error: "File exceeds the 200 MiB pin limit",
    };
  }

  const authHeaders = nostrBlossomAuthorizationHeaders(
    args.authEvent as object
  );

  for (const origin of NGIT_BLOSSOM_ORIGINS) {
    let host = "";
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (isGittrBlossomHostname(host)) continue;

    const headCtrl = new AbortController();
    const headTimer = setTimeout(() => headCtrl.abort(), 15_000);
    try {
      const reused = await blossomHeadExists(origin, sha256, headCtrl.signal);
      if (reused) {
        const url = resolvePinnedBlossomUrl({
          putOrigin: origin,
          sha256Hex: sha256,
        });
        if (url) return { ok: true, url, host, reused: true };
      }
    } finally {
      clearTimeout(headTimer);
    }

    for (const authorization of authHeaders) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
      try {
        const opened = await openForgeDownload(
          asset.downloadUrl,
          sha256,
          ctrl.signal
        );
        if (!opened) continue;
        const mimeHead = (asset.contentType || "").trim().split(";")[0];
        const mime = mimeHead || opened.contentType;
        const put = await putOnce({
          origin,
          sha256,
          authorization,
          body: opened.body,
          contentType: mime || "application/octet-stream",
          contentLength: asset.size > 0 ? asset.size : undefined,
          signal: ctrl.signal,
        });
        if (put.ok) {
          return { ok: true, url: put.url, host, reused: false };
        }
        if (put.status !== 401) break;
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (message.includes("sha256")) {
          return { ok: false, code: "hash_mismatch", error: message };
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    ok: false,
    code: "blossom_error",
    error:
      "Could not pin this file on public Blossom hosts. The forge download URL will still work.",
  };
}
