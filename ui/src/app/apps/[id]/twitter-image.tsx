// Declare locally so Next.js recognizes route config (re-exported const is ignored).
export const runtime = "nodejs";
export const revalidate = 3600;
// GITTR_APP_OG_CARD_REV=app1 — per-app card (hash must move with the drawing).
export {
  GITTR_APP_OG_CARD_REV,
  alt,
  contentType,
  size,
} from "./opengraph-image";
export { default } from "./opengraph-image";
