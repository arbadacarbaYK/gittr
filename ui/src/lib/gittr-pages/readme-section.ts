export const GITTR_PAGES_README_BEGIN = "<!-- gittr-pages:begin -->";
export const GITTR_PAGES_README_END = "<!-- gittr-pages:end -->";

export function readmeHasGittrPagesSection(readme: string): boolean {
  return readme.includes("gittr-pages:begin");
}

const GITTR_PAGES_BLOCK_RE =
  /<!-- gittr-pages:begin -->[\s\S]*?<!-- gittr-pages:end -->/;

/**
 * Markdown block appended to README so the canonical gittr Pages URL is visible after Push to Nostr.
 * One URL only: NIP-5A named site (pubkey base36 + repo d-tag), not the npub “root” host.
 */
export function buildGittrPagesReadmeAppend(
  namedUrl: string,
  dTag: string
): string {
  return `

${GITTR_PAGES_README_BEGIN}
## gittr Pages

**Live site** (\`${dTag}\`): ${namedUrl}

Published on relays per [NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md). Directory: [gittr.space/pages](https://gittr.space/pages).
${GITTR_PAGES_README_END}
`;
}

/** Single fenced block (markers + content), trimmed. */
export function gittrPagesReadmeBlockOnly(
  namedUrl: string,
  dTag: string
): string {
  return buildGittrPagesReadmeAppend(namedUrl, dTag).trim();
}

/**
 * Replace existing gittr Pages fenced block, or append a new one at the end.
 */
export function upsertGittrPagesReadmeSection(
  readme: string,
  namedUrl: string,
  dTag: string
): string {
  const block = gittrPagesReadmeBlockOnly(namedUrl, dTag);
  if (GITTR_PAGES_BLOCK_RE.test(readme)) {
    return readme.replace(GITTR_PAGES_BLOCK_RE, block);
  }
  const cur = readme.trimEnd();
  return cur ? `${cur}\n\n${block}` : block;
}

export function validateReadmeGittrPagesBlock(
  readme: string,
  namedUrl: string
): { ok: true } | { ok: false; message: string } {
  const trimmed = (readme ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      message:
        "README is empty. Either turn on “Let gittr update README for Pages on push” or add the gittr Pages block yourself.",
    };
  }
  if (!readme.includes("gittr-pages:begin")) {
    return {
      ok: false,
      message:
        "Add the fenced gittr Pages block (<!-- gittr-pages:begin --> … <!-- gittr-pages:end -->) with this repo’s live site URL, or enable auto-update on push.",
    };
  }
  const m = readme.match(GITTR_PAGES_BLOCK_RE);
  if (!m) {
    return {
      ok: false,
      message:
        "Found a begin marker but the gittr Pages block looks incomplete (missing <!-- gittr-pages:end -->).",
    };
  }
  const block = m[0];
  const u = namedUrl.trim();
  const uNoSlash = u.replace(/\/$/, "");
  if (!block.includes(u) && !block.includes(uNoSlash)) {
    return {
      ok: false,
      message: `The gittr Pages README block must include this repo’s live URL:\n${u}\n\nUpdate the block or enable auto-update on push.`,
    };
  }
  return { ok: true };
}
