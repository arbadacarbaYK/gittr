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

## If you do not see “Publish Pages manifest” in the sidebar

On the repo **Code** page, open **gittr Pages**. If there is **no** amber button **“Publish Pages manifest (Blossom + kind 35128)”**, the site you are using is still running an **older frontend build**. That button ships in current \`ngit\` \`ui\` source; **gittr.space must deploy that build** (sync \`ui/src\`, run \`yarn build\` / \`npm run build\`, restart the frontend service). Hard-refresh the browser after deploy. Until then, publish **35128 + Blossom blobs** with any other NIP-5A / nsite tool you use — this issue text does **not** go to relays.

## Manual path (current)

1. **Working tree** — Edit/add site files here (at least something that serves as \`/index.html\`). Use **Refetch from Nostr** only when this browser’s copy might not match relays (stale, edits on another device, sanity-check). After **you** push from this tab, gittr already stores event IDs locally — you do **not** need refetch before the next readme/site push for this session.
2. **README + live URL** — Sidebar **gittr Pages**: **README + Push to Nostr** is the usual one-shot after local edits; or the separate README button / “update on push” then **Push to Nostr**. README is separate from the gateway manifest.
3. **Push to Nostr** — Publishes repo + readme metadata (same as the shortcut’s push step).
4. **NIP-5A manifest (kind 35128)** — In gittr, owners use **Publish Pages manifest** in the repo sidebar (Blossom + 35128, NIP-07). Alternatively, upload blobs and publish with any **NIP-5A / nsite** tool. The gateway reads relays, not this issue text.

**Intended live URL (named site):**  
${namedUrl}

---

## JSON skeleton (fill hashes, then use your tool to sign & publish)

\`\`\`json
${JSON.stringify(jsonSkeleton, null, 2)}
\`\`\`

---

## What gittr already does vs what you still sign elsewhere

**Inside gittr:** edit files → **README + Push** (or stepwise README then Push). Refetch first is optional — for when relays should be the read source of truth, not because your own push “hasn’t arrived back” on this device (IDs are stored after publish).

**Outside this web UI (optional):** Any other NIP-5A signer that uploads blobs and publishes **35128**. In gittr, the sidebar button covers the usual flow. This issue remains a checklist + JSON skeleton if you prefer manual tooling.
`;

  return { title, body };
}
