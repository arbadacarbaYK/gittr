/**
 * Share link for the repo Share → Telegram button.
 *
 * Telegram Desktop builds a draft of `url + newline + text` and selects the
 * text. A blank line, or an emoji that takes two characters, makes that
 * selection land past the end of the draft. Desktop then logs
 * "Position out of range" and skips the message, so the share looks like an
 * error. The caption stays one line of ordinary characters. The page address
 * is only in the url parameter, which Telegram turns into the link preview.
 */
const NON_BMP = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

export function telegramShareCaption(repoName: string): string {
  const name = String(repoName || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(NON_BMP, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${name || "Repository"} on gittr`;
}

export function telegramShareUrl(pageUrl: string, repoName: string): string {
  const raw = String(pageUrl || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  if (parsed.username || parsed.password) return "";
  const text = telegramShareCaption(repoName);
  return `https://t.me/share/url?url=${encodeURIComponent(
    parsed.toString()
  )}&text=${encodeURIComponent(text)}`;
}
