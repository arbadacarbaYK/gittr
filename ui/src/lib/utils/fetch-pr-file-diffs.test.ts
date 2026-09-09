import { describe, expect, it } from "vitest";

import {
  extraCloneUrlsFromPrHtml,
  githubPullNumberFromPrRow,
  githubRepoSpecFromPrInput,
  mapGithubPullFilesJson,
  prDiffLooksLikeUnifiedPatch,
} from "./fetch-pr-file-diffs";

describe("githubPullNumberFromPrRow", () => {
  it("reads pr-N ids and GitHub html_url, not Nostr display numbers", () => {
    expect(githubPullNumberFromPrRow({ id: "pr-52" })).toBe(52);
    expect(
      githubPullNumberFromPrRow({
        html_url: "https://github.com/arbadacarbaYK/gittr-mcp/pull/12",
      })
    ).toBe(12);
    expect(
      githubPullNumberFromPrRow({
        html_url: "https://codeberg.org/owner/repo/pulls/8",
      })
    ).toBe(8);
    expect(
      githubPullNumberFromPrRow({
        id: "9f1730445f0b3760fdcf06b2422c6ba39355f3ba13dc78251d9180412bf25a93",
        number: "35",
      })
    ).toBe(null);
  });
});

describe("githubRepoSpecFromPrInput", () => {
  it("parses owner/repo from a GitHub pull html_url", () => {
    expect(
      githubRepoSpecFromPrInput({
        html_url: "https://github.com/arbadacarbaYK/gittr-mcp/pull/35",
      })
    ).toEqual({ owner: "arbadacarbaYK", repo: "gittr-mcp" });
  });
});

describe("extraCloneUrlsFromPrHtml", () => {
  it("turns GitHub and Codeberg PR pages into clone URLs", () => {
    expect(
      extraCloneUrlsFromPrHtml(
        "https://github.com/arbadacarbaYK/gittr-mcp/pull/1"
      )
    ).toEqual(["https://github.com/arbadacarbaYK/gittr-mcp.git"]);
    expect(
      extraCloneUrlsFromPrHtml("https://codeberg.org/forgejo/forgejo/pulls/1")
    ).toEqual(["https://codeberg.org/forgejo/forgejo.git"]);
  });
});

describe("mapGithubPullFilesJson", () => {
  it("maps GitHub files API patches onto FileDiffViewer after", () => {
    const files = mapGithubPullFilesJson([
      {
        filename: "server.js",
        status: "modified",
        patch:
          "@@ -1,2 +1,2 @@\n-const VERSION = '1.0.0';\n+const VERSION = pkg.version;\n",
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("server.js");
    expect(files[0]!.diffPreview).toBe(true);
    expect(prDiffLooksLikeUnifiedPatch(files[0]!.after)).toBe(true);
  });
});
