/**
 * True when fileContent is a data URL that must not be dumped into the text
 * CodeViewer (extensionless binaries often arrive as application/octet-stream).
 */
export function isOpaqueBinaryDataUrl(content: string | null | undefined): boolean {
  if (!content || !content.startsWith("data:")) return false;
  const header = content.slice(0, content.indexOf(",") === -1 ? 128 : content.indexOf(","));
  // Allow text + common previewable media through to typed viewers / decoders.
  if (/^data:text\//i.test(header)) return false;
  if (/^data:image\//i.test(header)) return false;
  if (/^data:audio\//i.test(header)) return false;
  if (/^data:video\//i.test(header)) return false;
  if (/^data:application\/(pdf|json|xml|javascript|xhtml\+xml)/i.test(header)) {
    return false;
  }
  return true;
}
