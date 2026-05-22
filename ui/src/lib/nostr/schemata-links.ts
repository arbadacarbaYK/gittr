/** Nostr schemata (nostrability) hosted on gittr — canonical NIP/kind docs for gittr stack. */
export const SCHEMATA_REPO =
  "https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata";

export function schemataFileUrl(filePath: string): string {
  const base = `${SCHEMATA_REPO}?file=README.md`;
  if (!filePath || filePath === "README.md") return base;
  return `${base}&path=${encodeURIComponent(filePath)}`;
}

export const SCHEMATA_NIP34 = schemataFileUrl("nips/nip-34");
export const SCHEMATA_NIP19 = schemataFileUrl("nips/nip-19");
export const SCHEMATA_NIP25 = schemataFileUrl("nips/nip-25");
export const SCHEMATA_NIP51 = schemataFileUrl("nips/nip-51");
export const SCHEMATA_NIP46 = schemataFileUrl("nips/nip-46");
export const SCHEMATA_NIP57 = schemataFileUrl("nips/nip-57");
export const SCHEMATA_NIP_C0 = schemataFileUrl("nips/nip-C0");
