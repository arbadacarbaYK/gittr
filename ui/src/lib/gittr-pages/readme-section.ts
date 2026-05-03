export const GITTR_PAGES_README_BEGIN = "<!-- gittr-pages:begin -->";
export const GITTR_PAGES_README_END = "<!-- gittr-pages:end -->";

export function readmeHasGittrPagesSection(readme: string): boolean {
  return readme.includes("gittr-pages:begin");
}

/**
 * Markdown block appended to README so the live site links are visible to everyone after Push to Nostr.
 */
export function buildGittrPagesReadmeAppend(
  namedUrl: string,
  rootUrl: string,
  dTag: string
): string {
  return `

${GITTR_PAGES_README_BEGIN}
## gittr Pages

- **Live (named \`${dTag}\`):** ${namedUrl}
- **Live (root):** ${rootUrl}

Published on relays per [NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md). Tools: [nsyte.run](https://nsyte.run) · [gittr /pages](https://gittr.space/pages).
${GITTR_PAGES_README_END}
`;
}
