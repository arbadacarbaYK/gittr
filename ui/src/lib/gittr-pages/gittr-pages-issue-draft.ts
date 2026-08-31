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
  const title = `Nostr Pages: NIP-5A manifest draft (${dTag})`;

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

  const body = `This issue was opened from **gittr** on this repo (\`${entity}/${repo}\`). gittr tracks work **here on Nostr**. When the repo has a GitHub upstream, gittr can also **refetch GitHub issues** into the same timeline — so a Nostr-only issue number may 404 on GitHub (that is expected).

## Owners: do not use this issue to publish the site

If you own this repo, use **Nostr Pages → Push Manifest** on the Code page. That uploads files to Blossom and publishes kind **35128**. Amber / NIP-46 is supported (same signer as Push to Nostr). Opening this tracking issue does **not** publish a manifest and is **not** a pull request.

## If you do not see “Push Manifest” in the sidebar

On the repo **Code** page, open **Nostr Pages**. Contributors without owner session see this tracking issue instead. If the owner button is missing, the site may still be on an older frontend build — hard-refresh after deploy, or publish **35128 + Blossom blobs** with any other NIP-5A / nsite tool. This issue text does **not** go to relays as a site.

## Manual path (current)

1. **Working tree** — Edit/add site files here (at least something that serves as \`/index.html\`). Use **Refetch from Nostr** only when this browser’s copy might not match relays (stale, edits on another device, sanity-check). After **you** push from this tab, gittr already stores event IDs locally — you do **not** need refetch before the next readme/site push for this session.
2. **README + live URL** — Sidebar **Nostr Pages**: **README + Push to Nostr** is the usual one-shot after local edits; or the separate README button / “update on push” then **Push to Nostr**. README is separate from the gateway manifest.
3. **Push to Nostr** — Publishes repo + readme metadata (same as the shortcut’s push step).
4. **NIP-5A manifest (kind 35128)** — Owners use **Push Manifest** in the repo sidebar (Blossom + 35128, NIP-07 or Amber). Alternatively, upload blobs and publish with any **NIP-5A / nsite** tool. **nsite-gateway** status UI reads optional \`relay\` tags on the manifest (one \`wss://…\` per tag); gittr **Push Manifest** adds those from your configured relay list.

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
