export const GITTR_PAGES_PUBLISHED_EVENT = "gittr-pages-published";

export type GittrPagesPublishedDetail = {
  authorHex: string;
  dTag: string;
};

export function notifyGittrPagesPublished(
  detail: GittrPagesPublishedDetail
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(GITTR_PAGES_PUBLISHED_EVENT, { detail })
  );
}

const HEX64 = /^[0-9a-f]{64}$/i;
const D_TAG = /^[a-z0-9-]{0,13}$/;

export function parsePagesIngestParams(
  searchParams: URLSearchParams
): { authorHex: string; dTag: string } | { error: string } {
  const authorHex = (searchParams.get("author") || "").trim().toLowerCase();
  const dTag = (searchParams.get("d") || "").trim().toLowerCase();
  if (!HEX64.test(authorHex)) {
    return { error: "author must be 64-char hex" };
  }
  if (!D_TAG.test(dTag) || dTag.endsWith("-")) {
    return { error: "d must be a NIP-5A name (0–13 chars)" };
  }
  return { authorHex, dTag };
}

export function gatewayIngestUrl(
  pagesBase: string,
  authorHex: string,
  dTag: string
): string {
  const base = pagesBase.replace(/\/$/, "");
  const qs = new URLSearchParams({ pubkey: authorHex });
  if (dTag) qs.set("d", dTag);
  return `${base}/status/ingest?${qs.toString()}`;
}
