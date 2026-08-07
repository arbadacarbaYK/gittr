import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { markdownRehypePlugins } from "./markdown-rehype-plugins";

async function renderMarkdown(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(markdownRehypePlugins as any)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

describe("markdownRehypePlugins", () => {
  it("strips script tags from raw HTML in markdown", async () => {
    const html = await renderMarkdown(
      "Hello <script>alert(1)</script><b>world</b>"
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("<b>world</b>");
  });

  it("strips inline event handlers", async () => {
    const html = await renderMarkdown(
      '<img src="https://example.com/a.png" onerror="alert(1)" alt="x">'
    );
    expect(html).not.toMatch(/onerror/i);
    expect(html).toMatch(/<img/i);
  });

  it("keeps language class on fenced code for mermaid routing", async () => {
    const html = await renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toMatch(/language-mermaid/);
  });
});
