// Declare locally so Next.js recognizes route config (re-exported const is ignored).
export const runtime = "nodejs";
export const revalidate = 3600;
// GITTR_OG_CARD_REV=about4 — wrapped About + vanity 307 (hash must move).
export { GITTR_OG_CARD_REV, alt, contentType, size } from "./opengraph-image";
export { default } from "./opengraph-image";
