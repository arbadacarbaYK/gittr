/** NIP-34 default placeholder when no real description was set. */
export function isPlaceholderRepositoryDescription(
  description: string | undefined | null,
  repoName: string
): boolean {
  const d = (description || "").trim();
  if (!d) return true;
  const slug = (repoName || "").trim().toLowerCase();
  if (!slug) return d.toLowerCase().startsWith("repository:");
  return (
    d.toLowerCase() === `repository: ${slug}` ||
    d.toLowerCase() === `repository:${slug}` ||
    d.toLowerCase().startsWith("imported from ")
  );
}

/**
 * Repo descriptions are often plain text with decorative `---` separators
 * between languages. In Markdown, `text\n---` is a setext heading and the
 * About sidebar renders it huge. Neutralize those underlines (and soft-escape
 * ATX `#` headings) so About stays body-sized.
 */
export function sanitizeDescriptionForMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Setext underline: only = or - (3+), optionally with spaces
    const isSetextUnderline =
      /^(=+|-+)\s*$/.test(trimmed) && trimmed.length >= 3;
    if (isSetextUnderline) {
      const prev = out.length > 0 ? out[out.length - 1].trim() : "";
      if (prev.length > 0) {
        // Paragraph break instead of promoting previous line to h1/h2
        if (out[out.length - 1] !== "") out.push("");
        continue;
      }
    }
    // Soft-escape ATX headings so "# Title" stays readable text in About
    if (/^#{1,6}\s+/.test(line)) {
      out.push(line.replace(/^(#{1,6})(\s+)/, (_m, hashes: string, sp: string) =>
        `${hashes.split("").map(() => "\\#").join("")}${sp}`
      ));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function sidebarAboutText(
  description: string | undefined | null,
  repoName: string
): string {
  const d = (description || "").trim();
  if (!d || isPlaceholderRepositoryDescription(d, repoName)) return "";
  return sanitizeDescriptionForMarkdown(d);
}

/** Repo cards (home, explore, repositories list): real blurb only, never "Imported from …". */
export function repoCardDescriptionText(
  description: string | undefined | null,
  repoName: string
): string {
  return sidebarAboutText(description, repoName);
}
