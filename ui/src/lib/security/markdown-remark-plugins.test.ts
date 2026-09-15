import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { markdownRehypePlugins } from "./markdown-rehype-plugins";
import { markdownRemarkPlugins } from "./markdown-remark-plugins";

async function renderMarkdown(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(markdownRemarkPlugins as any)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(markdownRehypePlugins as any)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

describe("markdownRemarkPlugins", () => {
  it("turns GitHub gemoji shortcodes into Unicode emoji in tables", async () => {
    const html = await renderMarkdown(
      [
        "| Status | OS |",
        "| --- | --- |",
        "| :no_entry: | Omarchy Linux |",
        "| :building_construction: | Ubuntu |",
        "| :question: | CachyOS |",
        "| :identification_card: | Apple macOS |",
      ].join("\n")
    );
    expect(html).toContain("⛔");
    expect(html).toContain("🏗️");
    expect(html).toContain("❓");
    expect(html).toContain("🪪");
    expect(html).not.toContain(":no_entry:");
    expect(html).not.toContain(":building_construction:");
    expect(html).not.toContain(":question:");
    expect(html).not.toContain(":identification_card:");
  });

  it("leaves unknown shortcodes as literal text", async () => {
    const html = await renderMarkdown("Status: :not_a_real_emoji:");
    expect(html).toContain(":not_a_real_emoji:");
  });

  it("does not convert shortcodes inside fenced code", async () => {
    const html = await renderMarkdown("```\n:no_entry:\n```");
    expect(html).toContain(":no_entry:");
    expect(html).not.toContain("⛔");
  });
});
