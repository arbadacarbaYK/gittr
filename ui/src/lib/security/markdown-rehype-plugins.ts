/**
 * Shared rehype pipeline for user/Nostr-sourced markdown.
 *
 * Always pair rehype-raw with rehype-sanitize. Raw alone injects arbitrary
 * HTML into the React tree (XSS). Sanitize uses GitHub-style defaults and
 * keeps className on code/pre so fenced language-* (incl. mermaid) still works.
 */
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className"], ["class"]],
    pre: [...(defaultSchema.attributes?.pre || []), ["className"], ["class"]],
    span: [...(defaultSchema.attributes?.span || []), ["className"], ["class"]],
  },
};

/** Use as: rehypePlugins={markdownRehypePlugins} — never rehypeRaw alone. */
export const markdownRehypePlugins: [
  typeof rehypeRaw,
  [typeof rehypeSanitize, typeof markdownSanitizeSchema]
] = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]];
