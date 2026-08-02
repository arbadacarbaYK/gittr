"use client";

import { useEffect, useState } from "react";

type Props = {
  alt?: string;
  primarySrc: string;
  /** Relative path in the repo (for same-origin API fallback). */
  repoPath?: string;
  sourceUrl?: string;
  branch?: string;
  className?: string;
};

/**
 * README images often point at raw.githubusercontent.com. Some browsers / Brave
 * shields fail those hotlinks (especially SVG). Fall back to our file-content API
 * (same origin) and render a data URL.
 */
export function ReadmeMarkdownImage({
  alt = "",
  primarySrc,
  repoPath,
  sourceUrl,
  branch = "main",
  className = "max-w-full h-auto rounded",
}: Props) {
  const [src, setSrc] = useState(primarySrc);
  const [triedApi, setTriedApi] = useState(false);

  useEffect(() => {
    setSrc(primarySrc);
    setTriedApi(false);
  }, [primarySrc, repoPath, sourceUrl, branch]);

  useEffect(() => {
    if (!src || triedApi || !repoPath || !sourceUrl) return;
    // Prefer same-origin for SVG up front — raw GitHub SVG often fails as <img> in Brave.
    if (!/\.svg(\?|#|$)/i.test(repoPath) && !/\.svg(\?|#|$)/i.test(primarySrc)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({
          sourceUrl: sourceUrl.replace(/\.git$/, ""),
          path: repoPath,
          branch,
        });
        const res = await fetch(`/api/git/file-content?${q.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          content?: string;
          isBinary?: boolean;
        };
        if (!data.content || cancelled) return;
        const b64 = data.content.replace(/\s/g, "");
        const dataUrl = data.isBinary
          ? `data:image/svg+xml;base64,${b64}`
          : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.content)}`;
        setTriedApi(true);
        setSrc(dataUrl);
      } catch {
        /* keep primarySrc; onError may retry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, triedApi, repoPath, sourceUrl, branch, primarySrc]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ maxWidth: "100%", width: "auto", height: "auto" }}
      onError={async () => {
        if (triedApi || !repoPath || !sourceUrl) {
          console.warn("⚠️ [README] Image failed to load:", primarySrc);
          return;
        }
        setTriedApi(true);
        try {
          const q = new URLSearchParams({
            sourceUrl: sourceUrl.replace(/\.git$/, ""),
            path: repoPath,
            branch,
          });
          const res = await fetch(`/api/git/file-content?${q.toString()}`);
          if (!res.ok) {
            console.warn("⚠️ [README] Image failed to load:", primarySrc);
            return;
          }
          const data = (await res.json()) as {
            content?: string;
            isBinary?: boolean;
          };
          if (!data.content) {
            console.warn("⚠️ [README] Image failed to load:", primarySrc);
            return;
          }
          const ext = (repoPath.split(".").pop() || "").toLowerCase();
          const mime =
            ext === "svg"
              ? "image/svg+xml"
              : ext === "png"
                ? "image/png"
                : ext === "jpg" || ext === "jpeg"
                  ? "image/jpeg"
                  : ext === "gif"
                    ? "image/gif"
                    : ext === "webp"
                      ? "image/webp"
                      : "application/octet-stream";
          if (data.isBinary) {
            setSrc(`data:${mime};base64,${data.content.replace(/\s/g, "")}`);
          } else {
            setSrc(
              `data:${mime};charset=utf-8,${encodeURIComponent(data.content)}`
            );
          }
        } catch {
          console.warn("⚠️ [README] Image failed to load:", primarySrc);
        }
      }}
    />
  );
}
