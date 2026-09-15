/**
 * Shared remark pipeline for user/Nostr-sourced markdown.
 *
 * GFM (tables, strikethrough, task lists) plus GitHub gemoji shortcodes
 * (`:no_entry:` → ⛔). Unknown `:codes:` stay as text. Fenced/inline code
 * is left alone.
 */
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";

/** Use as: remarkPlugins={markdownRemarkPlugins} */
export const markdownRemarkPlugins: [typeof remarkGfm, typeof remarkGemoji] = [
  remarkGfm,
  remarkGemoji,
];
