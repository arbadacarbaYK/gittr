/** GitHub/bridge wins over leftover gittr_files / gittr_overrides. Local is fallback. */
export function pickManifestFileBytes(
  remote: Uint8Array | null,
  local: Uint8Array | null
): Uint8Array | null {
  if (remote && remote.length > 0) return remote;
  if (local && local.length > 0) return local;
  return null;
}

export function uint8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
