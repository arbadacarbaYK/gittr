"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

import {
  normalizeRepoPath,
  resolveRepoMarkdownHref,
  type MarkdownHrefContext,
} from "./markdown-repo-href";

export type MarkdownAnchorContext = MarkdownHrefContext & {
  /**
   * Same-repo `?path=` / `?file=` navigations — avoid full reload races that
   * wipe the query string before React adopts it.
   */
  onRepoQueryNavigate?: (href: string) => void;
};

export { normalizeRepoPath, resolveRepoMarkdownHref };

type MarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
  children?: ReactNode;
};

const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

function resolveLinkTarget(
  href: string,
  explicitTarget?: string
): string | undefined {
  if (explicitTarget) return explicitTarget;
  if (href.startsWith("#")) return undefined;
  if (href.startsWith("/")) return undefined;
  if (
    typeof window !== "undefined" &&
    href.startsWith(window.location.origin)
  ) {
    return undefined;
  }
  return "_blank";
}

function MarkdownAnchorInner({
  href,
  children,
  className,
  target,
  rel,
  ctx,
  ...rest
}: MarkdownAnchorProps & { ctx?: MarkdownAnchorContext }) {
  const rawHref = typeof href === "string" ? href.trim() : "";
  if (!rawHref) {
    return <span className={className}>{children}</span>;
  }

  const youtubeMatch = rawHref.match(YOUTUBE_REGEX);
  if (youtubeMatch?.[1]) {
    const videoId = youtubeMatch[1];
    return <YoutubeEmbed videoId={videoId} />;
  }

  let resolvedHref = rawHref;
  if (ctx?.getRepoLink) {
    const isExternal =
      rawHref.startsWith("http://") || rawHref.startsWith("https://");
    if (!isExternal || rawHref.includes("gittr.space")) {
      resolvedHref = resolveRepoMarkdownHref(rawHref, ctx);
    }
  } else if (
    rawHref.includes("gittr.space") ||
    rawHref.startsWith("http://") ||
    rawHref.startsWith("https://")
  ) {
    resolvedHref = resolveRepoMarkdownHref(rawHref, {
      getRepoLink: () => "",
    });
  }

  const linkTarget = resolveLinkTarget(resolvedHref, target);
  const linkRel =
    rel ?? (linkTarget === "_blank" ? "noopener noreferrer" : undefined);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (linkTarget === "_blank") return;
    if (!ctx?.onRepoQueryNavigate) return;
    if (
      !resolvedHref.startsWith("/") &&
      !(
        typeof window !== "undefined" &&
        resolvedHref.startsWith(window.location.origin)
      )
    ) {
      return;
    }
    try {
      const u = new URL(
        resolvedHref,
        typeof window !== "undefined"
          ? window.location.origin
          : "https://gittr.space"
      );
      if (
        typeof window !== "undefined" &&
        u.origin !== window.location.origin
      ) {
        return;
      }
      if (!u.searchParams.has("path") && !u.searchParams.has("file")) return;
      e.preventDefault();
      ctx.onRepoQueryNavigate(`${u.pathname}${u.search}${u.hash}`);
    } catch {
      /* fall through to default navigation */
    }
  };

  return (
    <a
      {...rest}
      href={resolvedHref}
      target={linkTarget}
      rel={linkRel}
      className={className ?? "text-purple-400 hover:text-purple-300"}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

function YoutubeEmbed({ videoId }: { videoId: string }) {
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

/**
 * Repo-aware markdown links: relative `./snippets/…` → `?path=…`, gittr path URLs, YouTube embeds.
 * Pattern from gittr-helper-tools `snippets/markdown-media-handling/markdown-media.tsx`.
 */
export function createMarkdownAnchor(ctx: MarkdownAnchorContext) {
  const Anchor = (props: MarkdownAnchorProps) => (
    <MarkdownAnchorInner {...props} ctx={ctx} />
  );
  Anchor.displayName = "MarkdownAnchor";
  return Anchor;
}

/** Fallback without repo context (external / gittr.space rewrite only). */
export function MarkdownAnchor(props: MarkdownAnchorProps) {
  return <MarkdownAnchorInner {...props} />;
}
