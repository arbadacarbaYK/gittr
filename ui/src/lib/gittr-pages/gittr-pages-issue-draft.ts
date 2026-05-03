/** sessionStorage key — must match issues/new prefill reader */
export const GITTR_PAGES_ISSUE_PREFILL_KEY = "gittr_pages_issue_prefill";

export type GittrPagesIssueDraftInput = {
  entity: string;
  repo: string;
  ownerPubkeyHex: string;
  namedUrl: string;
  dTag: string;
};

/**
 * Markdown for a **gittr-only** tracking issue: manual NIP-5A path + JSON skeleton.
 * User replaces SHA256 placeholders after Blossom (or their tool) uploads blobs.
 */
export function buildGittrPagesManifestIssueDraft(
  input: GittrPagesIssueDraftInput
): { title: string; body: string } {
  const { entity, repo, ownerPubkeyHex, namedUrl, dTag } = input;
  const title = `gittr Pages: NIP-5A manifest draft (${dTag})`;

  const jsonSkeleton = {
    note: "Draft only — not a signed Nostr event. Your NIP-5A / nsite tool builds kind 35128 with id, created_at, sig.",
    kind: 35128,
    pubkey: ownerPubkeyHex,
    content: "",
    tags: [
      ["d", dTag],
      [
        "path",
        "/index.html",
        "REPLACE_SHA256_HEX_64_CHARS_AFTER_YOU_UPLOAD_INDEX_HTML_TO_BLOSSOM",
      ],
      ["title", "REPLACE_WITH_SITE_TITLE"],
    ],
  };

  const body = `This issue was opened from **gittr** on this same repo (\`${entity}/${repo}\`). It exists only here and on Nostr when you submit it — **gittr issues are not mirrored to any external forge** (there is no automatic GitHub/GitLab issue sync).

## Manual path (current)

1. **Working tree** — If files are missing or stale locally, use **Refetch from Nostr** on this repo in gittr, then edit/add site files here (at least something that serves as \`/index.html\`).
2. **Optional README** — Use the sidebar **gittr Pages** block (button or “update on push”) so the live URL appears in the readme; that is separate from the gateway manifest.
3. **Push to Nostr** — Publish repo + readme metadata from gittr.
4. **NIP-5A manifest (kind 35128)** — Upload blobs (e.g. Blossom), replace the SHA256 placeholders below, then publish the real replaceable event with your usual **NIP-5A / nsite** signer. The gittr gateway reads relays, not this issue text.

**Intended live URL (named site):**  
${namedUrl}

---

## JSON skeleton (fill hashes, then use your tool to sign & publish)

\`\`\`json
${JSON.stringify(jsonSkeleton, null, 2)}
\`\`\`

---

## “Full gittr flow” (not built yet)

Doing everything inside gittr with a single button would still mean **multiple signatures** (repo state, optional readme merge, NIP-5A manifest, maybe repo metadata). That product path is planned separately; today this issue + the sidebar are the supported **manual** helpers.
`;

  return { title, body };
}
