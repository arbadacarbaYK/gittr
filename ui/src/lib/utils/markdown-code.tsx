"use client";

import type { ReactNode } from "react";

import { CopyableCodeBlock } from "@/components/ui/copyable-code-block";
import { MermaidRenderer } from "@/components/ui/mermaid-renderer";

type HastLike = {
  type?: string;
  tagName?: string;
  parent?: HastLike;
};

export type MarkdownCodeProps = {
  node?: HastLike;
  className?: string;
  children?: ReactNode;
  /** Removed in react-markdown v10; kept for call-site compatibility. */
  inline?: boolean;
};

function isInsidePre(node?: HastLike): boolean {
  let current = node?.parent;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (current.type === "element" && current.tagName === "pre") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Fenced ``` blocks: `<pre><code class="language-…">` or multiline `<pre><code>`.
 * Single backticks (tables, prose, parentheses) must stay inline.
 */
export function isMarkdownBlockCode(
  node?: HastLike,
  className?: string,
  content?: string
): boolean {
  if (className && /language-/.test(className)) return true;
  if (!isInsidePre(node)) return false;
  const text = (content ?? "").trim();
  if (!text.includes("\n") && text.length < 160) return false;
  return true;
}

const inlineCodeClassName =
  "bg-gray-900 px-1 py-0.5 rounded text-green-400 not-prose inline align-baseline";

/**
 * Renders markdown `code`: inline backticks stay in the sentence; fenced blocks use CopyableCodeBlock.
 */
export function MarkdownCode({ node, className, children }: MarkdownCodeProps) {
  const content = String(children ?? "").replace(/\n$/, "");
  const language = /language-([\w-]+)/
    .exec(className || "")?.[1]
    ?.toLowerCase();
  const block = isMarkdownBlockCode(node, className, content);

  if (block && language === "mermaid") {
    return <MermaidRenderer code={content} className="my-4" />;
  }

  if (!block) {
    return (
      <CopyableCodeBlock inline className={inlineCodeClassName}>
        {children}
      </CopyableCodeBlock>
    );
  }

  return (
    <CopyableCodeBlock
      inline={false}
      className={className || "bg-gray-900 rounded p-2 overflow-x-auto my-0.5"}
    >
      {children}
    </CopyableCodeBlock>
  );
}
