"use client";

import { useEffect, useState } from "react";

import { localOverrideDisplayUrl } from "@/lib/repos/local-override-media";
import { hydrateRepoOverrideBlobs } from "@/lib/repos/overrides-idb";
import {
  mimeForRepoImagePath,
  resolveReadmeMarkdownImage,
} from "@/lib/repos/resolve-readme-markdown-image";

type Props = {
  alt?: string;
  /** Raw markdown `src` (relative or absolute). */
  src?: string;
  branch?: string;
  forgeSourceUrl?: string | null;
  cloneUrls?: string[] | null;
  ownerPubkey?: string | null;
  repoName?: string | null;
  /** Entity (npub) — required to prefer unpushed local media overrides. */
  entity?: string | null;
  className?: string;
};

type FetchOk = { dataUrl: string };

async function fetchViaGitFileContent(
  sourceUrl: string,
  path: string,
  branch: string
): Promise<FetchOk | null> {
  const q = new URLSearchParams({
    sourceUrl: sourceUrl.replace(/\.git$/, ""),
    path,
    branch,
  });
  const res = await fetch(`/api/git/file-content?${q.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string; isBinary?: boolean };
  if (!data.content) return null;
  const mime = mimeForRepoImagePath(path);
  if (data.isBinary) {
    return {
      dataUrl: `data:${mime};base64,${data.content.replace(/\s/g, "")}`,
    };
  }
  if (mime === "image/svg+xml") {
    return {
      dataUrl: `data:${mime};charset=utf-8,${encodeURIComponent(data.content)}`,
    };
  }
  return {
    dataUrl: `data:${mime};base64,${btoa(data.content)}`,
  };
}

async function fetchViaNostrBridge(
  ownerPubkey: string,
  repo: string,
  path: string,
  branch: string
): Promise<FetchOk | null> {
  const q = new URLSearchParams({
    ownerPubkey,
    repo,
    path,
    branch,
  });
  const res = await fetch(`/api/nostr/repo/file-content?${q.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string; isBinary?: boolean };
  if (!data.content) return null;
  const mime = mimeForRepoImagePath(path);
  if (data.isBinary) {
    return {
      dataUrl: `data:${mime};base64,${data.content.replace(/\s/g, "")}`,
    };
  }
  if (mime === "image/svg+xml") {
    return {
      dataUrl: `data:${mime};charset=utf-8,${encodeURIComponent(data.content)}`,
    };
  }
  return {
    dataUrl: `data:${mime};base64,${btoa(data.content)}`,
  };
}

/**
 * README images: relative paths (e.g. docs/assets/*.png) must render on
 * Nostr-native / GRASP repos via same-origin file APIs — not invent /raw/ URLs
 * and not require Blossom for in-repo assets.
 *
 * Unpushed Upload overwrites (gif/png/…) live in gittr_overrides (large/binary
 * bodies in IndexedDB) and must win over forge/bridge tip until Push.
 */
export function ReadmeMarkdownImage({
  alt = "",
  src = "",
  branch = "main",
  forgeSourceUrl,
  cloneUrls,
  ownerPubkey,
  repoName,
  entity,
  className = "max-w-full h-auto rounded",
}: Props) {
  const [displaySrc, setDisplaySrc] = useState("");
  const [apiTried, setApiTried] = useState(false);
  const [meta, setMeta] = useState(() =>
    resolveReadmeMarkdownImage({
      src,
      branch,
      forgeSourceUrl,
      cloneUrls,
      ownerPubkey,
      repoName,
    })
  );

  useEffect(() => {
    const next = resolveReadmeMarkdownImage({
      src,
      branch,
      forgeSourceUrl,
      cloneUrls,
      ownerPubkey,
      repoName,
    });
    setMeta(next);

    let cancelled = false;
    (async () => {
      // Prefer local unpushed override before any forge hotlink / tip fetch.
      // Binary drafts may live in IndexedDB — hydrate then re-check.
      if (entity && repoName && next?.repoPath) {
        try {
          await hydrateRepoOverrideBlobs(entity, repoName);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        const local = localOverrideDisplayUrl(entity, repoName, next.repoPath);
        if (local) {
          setDisplaySrc(local);
          setApiTried(true);
          return;
        }
      }

      if (cancelled) return;
      setDisplaySrc(next?.primarySrc || "");
      setApiTried(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [src, branch, forgeSourceUrl, cloneUrls, ownerPubkey, repoName, entity]);

  useEffect(() => {
    if (!meta?.repoPath || apiTried) return;
    const needsApi =
      meta.preferApi ||
      !meta.primarySrc ||
      /\.svg(\?|#|$)/i.test(meta.repoPath);

    if (!needsApi && meta.primarySrc) return;

    let cancelled = false;
    (async () => {
      try {
        // Prefer bridge when we have identity — forge raw may be wrong fork/branch.
        let ok: FetchOk | null = null;
        if (meta.ownerPubkey && meta.repoName) {
          ok = await fetchViaNostrBridge(
            meta.ownerPubkey,
            meta.repoName,
            meta.repoPath!,
            branch
          );
        }
        if (!ok && meta.sourceUrl) {
          ok = await fetchViaGitFileContent(
            meta.sourceUrl,
            meta.repoPath!,
            branch
          );
        }
        if (!cancelled) {
          setApiTried(true);
          if (ok?.dataUrl) setDisplaySrc(ok.dataUrl);
        }
      } catch {
        if (!cancelled) setApiTried(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    apiTried,
    branch,
    meta?.preferApi,
    meta?.primarySrc,
    meta?.repoPath,
    meta?.sourceUrl,
    meta?.ownerPubkey,
    meta?.repoName,
  ]);

  if (!meta) return null;
  if (!displaySrc && !meta.preferApi) return null;
  if (!displaySrc) {
    return (
      <span className="text-sm text-gray-500 italic" title={meta.repoPath}>
        {alt || "Loading image…"}
      </span>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      style={{ maxWidth: "100%", width: "auto", height: "auto" }}
      onError={async () => {
        if (apiTried || !meta.repoPath) {
          console.warn("⚠️ [README] Image failed to load:", src);
          return;
        }
        setApiTried(true);
        try {
          let ok: FetchOk | null = null;
          if (meta.ownerPubkey && meta.repoName) {
            ok = await fetchViaNostrBridge(
              meta.ownerPubkey,
              meta.repoName,
              meta.repoPath,
              branch
            );
          }
          if (!ok && meta.sourceUrl) {
            ok = await fetchViaGitFileContent(
              meta.sourceUrl,
              meta.repoPath,
              branch
            );
          }
          if (ok?.dataUrl) setDisplaySrc(ok.dataUrl);
          else console.warn("⚠️ [README] Image failed to load:", src);
        } catch {
          console.warn("⚠️ [README] Image failed to load:", src);
        }
      }}
    />
  );
}
