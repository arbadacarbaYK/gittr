"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

export type MarkdownAnchorContext = {
  /** e.g. `() => \`/${entity}/${repo}\`` */
  getRepoLink: (subpath?: string) => string;
  /** Markdown file path for resolving `../` links (e.g. `README.md`, `docs/guide.md`) */
  basePath?: string | null;
  /** Current repo name — used to fix `/npub/.../snippets/...` style broken paths */
  repoName?: string;
  /** Current entity segment (`npub…`) */
  entity?: string;
};

type MarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
  children?: ReactNode;
};

const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;

const FILE_EXT_RE =
  /\.(md|mdx|txt|ts|tsx|js|jsx|json|ya?ml|toml|xml|html?|css|scss|svg|png|jpe?g|gif|webp|pdf|rs|go|py|sh|bash|zsh|lock|gitignore)$/i;

/** Normalize repo-relative paths (from gittr-helper-tools markdown-media snippet). */
export function normalizeRepoPath(path: string): string {
  if (!path) return "";
  const segments = path.replace(/\\/g, "/").trim().split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function resolveRepoRelativePath(
  targetPath: string,
  basePath?: string | null
): string {
  const trimmed = targetPath.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("#")
  ) {
    return trimmed;
  }

  const isRootRelative = trimmed.startsWith("/");
  const segments = trimmed.replace(/\\/g, "/").split("/");
  const stack: string[] = [];

  if (!isRootRelative && basePath) {
    const baseNormalized = normalizeRepoPath(basePath);
    if (baseNormalized) {
      const baseParts = baseNormalized.split("/");
      baseParts.pop();
      stack.push(...baseParts);
    }
  }

  if (isRootRelative) {
    stack.length = 0;
  }

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }

  return stack.join("/");
}

function splitHash(href: string): { path: string; hash: string } {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return { path: href, hash: "" };
  return { path: href.slice(0, hashIdx), hash: href.slice(hashIdx) };
}

/** Old gittr URLs used path segments for files; normalize to ?path= (preserve #L… hash). */
function rewriteGittrRepoPath(href: string, ctx?: MarkdownAnchorContext): string {
  const { path: pathOnly, hash } = splitHash(href);
  let working = pathOnly;

  if (
    working.includes("gittr.space") &&
    !working.includes("?path=") &&
    !working.includes("?file=") &&
    !working.includes("?branch=") &&
    !working.includes("api/")
  ) {
    const match = working.match(
      /^(https?:\/\/gittr\.space\/[^/]+\/[^/]+)\/([^?#]+)$/
    );
    if (match?.[1] && match?.[2]) {
      working = `${match[1]}?path=${encodeURIComponent(match[2])}`;
    }
  }

  // Fix `/npub…/snippets/…` (missing repo segment) when browsing a repo README
  if (ctx?.entity && ctx?.repoName && working.startsWith("/")) {
    const entityEsc = ctx.entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const repoEsc = ctx.repoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrongRepoPath = working.match(
      new RegExp(`^\\/(?:${entityEsc})(?:\\/([^/?#]+))(?:\\/(.+))?$`)
    );
    if (
      wrongRepoPath?.[1] &&
      wrongRepoPath[1] !== ctx.repoName &&
      wrongRepoPath[2]
    ) {
      const filePath = normalizeRepoPath(
        `${wrongRepoPath[1]}/${wrongRepoPath[2]}`
      );
      working = `${ctx.getRepoLink()}?path=${encodeURIComponent(filePath)}`;
    } else if (
      wrongRepoPath?.[1] &&
      wrongRepoPath[1] !== ctx.repoName &&
      !wrongRepoPath[2]
    ) {
      working = `${ctx.getRepoLink()}?path=${encodeURIComponent(
        normalizeRepoPath(wrongRepoPath[1])
      )}`;
    }

    const correctRepoExtra = working.match(
      new RegExp(`^\\/(?:${entityEsc})\\/${repoEsc}\\/(.+)$`)
    );
    if (correctRepoExtra?.[1] && !working.includes("?")) {
      working = `${ctx.getRepoLink()}?path=${encodeURIComponent(
        normalizeRepoPath(correctRepoExtra[1])
      )}`;
    }
  }

  return working + hash;
}

/** Resolve `./snippets/…` style links to `?path=` / `?file=` (gittr-helper-tools markdown-media-handling). */
export function resolveRepoMarkdownHref(
  rawHref: string,
  ctx: MarkdownAnchorContext
): string {
  const trimmed = rawHref.trim();
  if (!trimmed) return trimmed;

  if (trimmed.startsWith("#")) {
    return trimmed;
  }

  const { path: pathPart, hash } = splitHash(trimmed);
  const isExternal =
    pathPart.startsWith("http://") || pathPart.startsWith("https://");

  if (isExternal) {
    return rewriteGittrRepoPath(trimmed, ctx);
  }

  if (pathPart.startsWith("mailto:") || pathPart.startsWith("data:")) {
    return trimmed;
  }

  const repoBasePath = ctx.getRepoLink("");
  let resolved = resolveRepoRelativePath(pathPart, ctx.basePath);
  resolved = normalizeRepoPath(resolved.replace(/^\.\//, "").replace(/^\.$/, ""));

  if (!resolved) {
    return repoBasePath + hash;
  }

  const lastSegment = resolved.split("/").pop() || "";
  const looksLikeFile = FILE_EXT_RE.test(lastSegment);

  let url: string;
  if (looksLikeFile) {
    const pathParts = resolved.split("/");
    const dirPath =
      pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
    const encodedFile = encodeURIComponent(resolved);
    const encodedPath = dirPath ? encodeURIComponent(dirPath) : "";
    url = encodedPath
      ? `${repoBasePath}?path=${encodedPath}&file=${encodedFile}`
      : `${repoBasePath}?file=${encodedFile}`;
  } else {
    url = `${repoBasePath}?path=${encodeURIComponent(resolved)}`;
  }

  return url + hash;
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
    return (
      <YoutubeEmbed videoId={videoId} />
    );
  }

  let resolvedHref = rawHref;
  if (ctx?.getRepoLink) {
    const isExternal =
      rawHref.startsWith("http://") || rawHref.startsWith("https://");
    if (!isExternal || rawHref.includes("gittr.space")) {
      resolvedHref = isExternal
        ? rewriteGittrRepoPath(rawHref, ctx)
        : resolveRepoMarkdownHref(rawHref, ctx);
    }
  } else {
    resolvedHref = rewriteGittrRepoPath(rawHref);
  }

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
