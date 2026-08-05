// Declare locally so Next.js recognizes route config (re-exported const is ignored).
export const runtime = "nodejs";
export const revalidate = 3600;
export { alt, contentType, size } from "./opengraph-image";
export { default } from "./opengraph-image";
