import { describe, expect, it } from "vitest";

import {
  isDocumentationEligibleWebUrl,
  parseRepoLinksFromNip34Tags,
  stripNonDocumentationWebLinks,
} from "./parse-nip34-repo-links";

describe("parseRepoLinksFromNip34Tags", () => {
  it("labels git.iris.to web tags as Iris Git", () => {
    const links = parseRepoLinksFromNip34Tags([
      [
        "web",
        "https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/fips",
      ],
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.label).toBe("Iris Git");
    expect(links[0]?.type).toBe("docs");
    expect(links[0]?.url).toContain("git.iris.to");
  });

  it("does not invent Iris labels for other hosts", () => {
    const links = parseRepoLinksFromNip34Tags([
      ["web", "https://example.com/docs"],
    ]);
    expect(links[0]?.label).toBeUndefined();
    expect(links[0]?.type).toBe("docs");
  });

  it("does not treat gitworkshop browse web tags as Documentation", () => {
    const links = parseRepoLinksFromNip34Tags([
      [
        "web",
        "https://gitworkshop.dev/npub1ven4zk8xxw873876gx8y9g9l9fazkye9qnwnglcptgvfwxmygscqsxddfh/relay.ngit.dev/yuki-webui",
      ],
    ]);
    expect(links).toHaveLength(0);
  });

  it("keeps real homepage web URLs as docs", () => {
    const links = parseRepoLinksFromNip34Tags([
      ["web", "https://yuki.example.org/"],
    ]);
    expect(links).toEqual([{ type: "docs", url: "https://yuki.example.org/" }]);
  });

  it("parses explicit link tags (Settings / gittr)", () => {
    const links = parseRepoLinksFromNip34Tags([
      ["link", "docs", "https://docs.example.com/guide", "Guide"],
      ["web", "https://gitworkshop.dev/npub1abc/relay.ngit.dev/repo"],
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      type: "docs",
      url: "https://docs.example.com/guide",
      label: "Guide",
    });
  });

  it("skips image URLs in web tags", () => {
    const links = parseRepoLinksFromNip34Tags([
      ["web", "https://cdn.example.com/logo.png"],
    ]);
    expect(links).toHaveLength(0);
  });

  it("skips GRASP host + npub path web URLs", () => {
    expect(
      isDocumentationEligibleWebUrl(
        "https://relay.ngit.dev/npub1ven4zk8xxw873876gx8y9g9l9fazkye9qnwnglcptgvfwxmygscqsxddfh/yuki-webui"
      )
    ).toBe(false);
    const links = parseRepoLinksFromNip34Tags([
      [
        "web",
        "https://relay.ngit.dev/npub1ven4zk8xxw873876gx8y9g9l9fazkye9qnwnglcptgvfwxmygscqsxddfh/yuki-webui",
      ],
    ]);
    expect(links).toHaveLength(0);
  });
});

describe("stripNonDocumentationWebLinks", () => {
  it("drops unlabeled forge browse docs but keeps Website / Settings", () => {
    const cleaned = stripNonDocumentationWebLinks([
      {
        type: "docs",
        url: "https://gitworkshop.dev/npub1abc/relay.ngit.dev/repo",
      },
      {
        type: "docs",
        url: "https://example.com",
        label: "Website",
      },
      {
        type: "docs",
        url: "https://docs.example.com",
        label: "API docs",
      },
    ]);
    expect(cleaned.map((l) => l.url)).toEqual([
      "https://example.com",
      "https://docs.example.com",
    ]);
  });
});
