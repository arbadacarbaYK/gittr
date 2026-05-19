"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

type MarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
  children?: ReactNode;
};

const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

/** Old gittr URLs used path segments for files; normalize to ?path= */
function rewriteGittrRepoPath(href: string): string {
  if (
    !href.includes("gittr.space") ||
    href.includes("?path=") ||
    href.includes("?file=") ||
    href.includes("?branch=") ||
    href.includes("api/")
  ) {
    return href;
  }
  const match = href.match(
    /^(https?:\/\/gittr\.space\/[^/]+\/[^/]+)\/([^?#]+)$/
  );
  if (match?.[1] && match[2]) {
    return `${match[1]}?path=${encodeURIComponent(match[2])}`;
  }
  return href;
}

function resolveLinkTarget(
  href: string,
  explicitTarget?: string
): string | undefined {
  if (explicitTarget) return explicitTarget;
  if (href.startsWith("#")) return undefined;
  if (href.startsWith("/")) return undefined;
  if (typeof window !== "undefined" && href.startsWith(window.location.origin)) {
    return undefined;
  }
  return "_blank";
}

/**
 * Safe markdown link renderer for react-markdown.
 * Spread order matters: explicit href/target/rel must win over {...props}.
 */
export function MarkdownAnchor({
  node: _node,
  href,
  children,
  className,
  target,
  rel,
  ...rest
}: MarkdownAnchorProps) {
  const rawHref = typeof href === "string" ? href.trim() : "";
  if (!rawHref) {
    return <span className={className}>{children}</span>;
  }

  const youtubeMatch = rawHref.match(YOUTUBE_REGEX);
  if (youtubeMatch?.[1]) {
    const videoId = youtubeMatch[1];
    return (
      <div className="my-4">
        <iframe
          width="560"
          height="315"
          src={`https://www.youtube.com/embed/${videoId}`}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          className="w-full max-w-full rounded"
          style={{ aspectRatio: "16/9" }}
        />
      </div>
    );
  }

  const resolvedHref = rewriteGittrRepoPath(rawHref);
  const linkTarget = resolveLinkTarget(resolvedHref, target);
  const linkRel =
    rel ?? (linkTarget === "_blank" ? "noopener noreferrer" : undefined);

  return (
    <a
      {...rest}
      href={resolvedHref}
      target={linkTarget}
      rel={linkRel}
      className={className ?? "text-purple-400 hover:text-purple-300"}
    >
      {children}
    </a>
  );
}
