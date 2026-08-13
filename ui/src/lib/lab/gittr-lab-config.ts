/** Optional security-lab hub (`/lab` header link + server snapshot). */

export function gittrLabNavEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_GITTR_LAB_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}
