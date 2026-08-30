import {
  isAbsurdRepoPath,
  looksLikeRepoFileName,
  normalizeRepoPathSegments,
} from "../repos/repo-path-sanity";

export type MarkdownHrefContext = {
  getRepoLink: (subpath?: string) => string;
  basePath?: string | null;
  repoName?: string;
  entity?: string;
};

/** Normalize repo-relative paths (from gittr-helper-tools markdown-media snippet). */
export function normalizeRepoPath(path: string): string {
  return normalizeRepoPathSegments(path).join("/");
}

/** Join `./foo.gif` against the markdown file path (GitHub README semantics). */
export function resolveRepoRelativePath(
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
function rewriteGittrRepoPath(href: string, ctx?: MarkdownHrefContext): string {
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

/** Resolve `./snippets/…` style links to `?path=` / `?file=`. */
export function resolveRepoMarkdownHref(
  rawHref: string,
  ctx: MarkdownHrefContext
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
  resolved = normalizeRepoPath(
    resolved.replace(/^\.\//, "").replace(/^\.$/, "")
  );

  if (!resolved) {
    return repoBasePath + hash;
  }

  // Crawler trap: nested empty folders + root README basePath → infinite nests.
  if (isAbsurdRepoPath(resolved)) {
    return repoBasePath + hash;
  }

  const lastSegment = resolved.split("/").pop() || "";
  const looksLikeFile = looksLikeRepoFileName(lastSegment);

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
