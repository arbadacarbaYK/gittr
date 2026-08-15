/**
 * Sniff raw bytes so extensionless files (LICENSE, Makefile, "elmcanyon")
 * are not treated as binary just because a git host sent octet-stream.
 */
export function fileBytesLookLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  } catch {
    return false;
  }
  // Allow tab/newline/CR; reject other C0 controls.
  if (/[\x00-\x08\x0E-\x1F]/.test(text)) return false;
  return true;
}

export function httpBodyIsBinary(
  contentType: string | null | undefined,
  bytes: Uint8Array
): boolean {
  const ct = (contentType || "").toLowerCase();
  if (
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("css") ||
    ct.includes("markdown")
  ) {
    return false;
  }
  if (
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct.includes("pdf") ||
    ct.includes("zip") ||
    ct.includes("gzip") ||
    ct.includes("octet-stream") ||
    !ct
  ) {
    if (
      ct.startsWith("image/") ||
      ct.startsWith("audio/") ||
      ct.startsWith("video/") ||
      ct.includes("pdf") ||
      ct.includes("zip") ||
      ct.includes("gzip")
    ) {
      return true;
    }
    // octet-stream / missing type: sniff
    return !fileBytesLookLikeText(bytes);
  }
  return !fileBytesLookLikeText(bytes);
}
