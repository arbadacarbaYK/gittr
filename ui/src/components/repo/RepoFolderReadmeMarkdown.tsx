"use client";

import { memo, useDeferredValue, useEffect, useState } from "react";

import { ReadmeMarkdownImage } from "@/components/repo/ReadmeMarkdownImage";
import { markdownRehypePlugins } from "@/lib/security/markdown-rehype-plugins";
import { MarkdownCode } from "@/lib/utils/markdown-code";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Isolate README markdown parse from Code-page tree/date re-renders.
 * Idle-gated mount + useDeferredValue keeps Push / tabs clickable while a
 * large README catches up — markdown must not steal the first click window.
 */
export const RepoFolderReadmeMarkdown = memo(function RepoFolderReadmeMarkdown({
  markdown,
  headingComponents,
  proseCodeSafeComponents,
  markdownAnchor,
  branch,
  forgeSourceUrl,
  cloneUrls,
  ownerPubkey,
  repoName,
  entity,
}: {
  markdown: string;
  headingComponents: Record<string, unknown>;
  proseCodeSafeComponents: Record<string, unknown>;
  markdownAnchor: unknown;
  branch: string;
  forgeSourceUrl: string | null;
  cloneUrls: string[] | null;
  ownerPubkey: string | null;
  repoName: string;
  entity: string;
}) {
  const deferred = useDeferredValue(markdown);
  const [allowMount, setAllowMount] = useState(false);

  useEffect(() => {
    if (!deferred) {
      setAllowMount(false);
      return;
    }
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setAllowMount(true);
    };
    const w = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (
          cb: IdleRequestCallback,
          opts?: IdleRequestOptions
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(enable, { timeout: 400 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(enable, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [deferred]);

  if (!deferred || !allowMount) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={markdownRehypePlugins}
      components={
        {
          ...headingComponents,
          ...proseCodeSafeComponents,
          img: ({ ...props }: { src?: string; alt?: string }) => {
            return (
              <div className="my-4 overflow-x-auto">
                <ReadmeMarkdownImage
                  src={props.src || ""}
                  alt={props.alt || ""}
                  branch={branch}
                  forgeSourceUrl={forgeSourceUrl}
                  cloneUrls={cloneUrls}
                  ownerPubkey={ownerPubkey}
                  repoName={repoName}
                  entity={entity}
                />
              </div>
            );
          },
          a: markdownAnchor as any,
          code: MarkdownCode,
        } as any
      }
    >
      {deferred}
    </ReactMarkdown>
  );
});
