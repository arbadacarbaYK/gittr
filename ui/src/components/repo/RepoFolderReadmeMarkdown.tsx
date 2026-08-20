"use client";

import { memo, useDeferredValue } from "react";

import { ReadmeMarkdownImage } from "@/components/repo/ReadmeMarkdownImage";
import { markdownRehypePlugins } from "@/lib/security/markdown-rehype-plugins";
import { MarkdownCode } from "@/lib/utils/markdown-code";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Isolate README markdown parse from Code-page tree/date re-renders.
 * useDeferredValue keeps Push / tabs clickable while a large README catches up.
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
  if (!deferred) return null;
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
