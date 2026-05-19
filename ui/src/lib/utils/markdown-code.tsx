"use client";

import type { ReactNode } from "react";

import { CopyableCodeBlock } from "@/components/ui/copyable-code-block";
import { MermaidRenderer } from "@/components/ui/mermaid-renderer";

type HastParent = { type?: string; tagName?: string };

export type MarkdownCodeProps = {
  node?: { parent?: HastParent };
  className?: string;
  children?: ReactNode;
  /** Removed in react-markdown v10; kept for call-site compatibility. */
  inline?: boolean;
};

/** Fenced blocks are `<pre><code>`; inline backticks are `<code>` only. */
export function isMarkdownBlockCode(
  node?: MarkdownCodeProps["node"],
  className?: string
): boolean {
  if (className && /language-/.test(className)) return true;
  const parent = node?.parent;
  return parent?.type === "element" && parent?.tagName === "pre";
}

const inlineCodeClassName =
  "bg-gray-900 px-1 py-0.5 rounded text-green-400 not-prose inline align-baseline";

/**
 * Renders markdown `code`: inline backticks stay in the sentence; fenced blocks use CopyableCodeBlock.
 */
export function MarkdownCode({
  node,
  className,
  children,
}: MarkdownCodeProps) {
  const content = String(children ?? "").replace(/\n$/, "");
  const language = /language-([\w-]+)/
    .exec(className || "")?.[1]
    ?.toLowerCase();
  const block = isMarkdownBlockCode(node, className);

  if (block && language === "mermaid") {
    return <MermaidRenderer code={content} className="my-4" />;
  }

  if (!block) {
    return <code className={inlineCodeClassName}>{children}</code>;
  }

  return (
    <CopyableCodeBlock
      inline={false}
      className={
        className || "bg-gray-900 rounded p-2 overflow-x-auto my-0.5"
      }
    >
      {children}
    </CopyableCodeBlock>
  );
}
