import { describe, expect, it } from "vitest";

import {
  normalizeRepoRelPath,
  resolveReadmeMarkdownImage,
} from "./resolve-readme-markdown-image";

describe("resolveReadmeMarkdownImage", () => {
  it("normalizes relative asset paths", () => {
    expect(normalizeRepoRelPath("./docs/assets/a.png")).toBe(
      "docs/assets/a.png"
    );
    expect(normalizeRepoRelPath("/docs/assets/a.png")).toBe(
      "docs/assets/a.png"
    );
    expect(normalizeRepoRelPath("../secret")).toBe("");
    expect(
      normalizeRepoRelPath("file-fetch.gif", "snippets/file-fetching/README.md")
    ).toBe("snippets/file-fetching/file-fetch.gif");
    expect(
      normalizeRepoRelPath(
        "./file-fetch.png",
        "snippets/file-fetching/README.md"
      )
    ).toBe("snippets/file-fetching/file-fetch.png");
    expect(
      normalizeRepoRelPath("../secret.png", "snippets/file-fetching/README.md")
    ).toBe("snippets/secret.png");
  });

  it("keeps absolute https URLs", () => {
    const r = resolveReadmeMarkdownImage({
      src: "https://example.com/x.png",
      branch: "main",
    });
    expect(r?.primarySrc).toBe("https://example.com/x.png");
    expect(r?.preferApi).toBe(false);
  });

  it("maps GitHub relative paths to raw.githubusercontent.com", () => {
    const r = resolveReadmeMarkdownImage({
      src: "docs/assets/dashboard-map.png",
      branch: "main",
      forgeSourceUrl: "https://github.com/acme/lab-kit.git",
      ownerPubkey:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      repoName: "lab-kit",
    });
    expect(r?.preferApi).toBe(false);
    expect(r?.primarySrc).toContain("raw.githubusercontent.com/acme/lab-kit");
    expect(r?.primarySrc).toContain("docs/assets/dashboard-map.png");
    expect(r?.repoPath).toBe("docs/assets/dashboard-map.png");
    expect(r?.ownerPubkey).toHaveLength(64);
    expect(r?.repoName).toBe("lab-kit");
  });

  it("joins GitHub relative images to the README directory, not repo root", () => {
    const r = resolveReadmeMarkdownImage({
      src: "file-fetch.gif",
      branch: "main",
      markdownFilePath: "snippets/file-fetching/README.md",
      forgeSourceUrl: "https://github.com/arbadacarbaYK/gittr-helper-tools.git",
      ownerPubkey:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      repoName: "gittr-helper-tools",
    });
    expect(r?.preferApi).toBe(false);
    expect(r?.repoPath).toBe("snippets/file-fetching/file-fetch.gif");
    expect(r?.primarySrc).toBe(
      "https://raw.githubusercontent.com/arbadacarbaYK/gittr-helper-tools/main/snippets/file-fetching/file-fetch.gif"
    );
  });

  it("prefers bridge API for forge SVG so wrong fork/branch cannot break logos", () => {
    const r = resolveReadmeMarkdownImage({
      src: "docs/wok.svg",
      branch: "main",
      forgeSourceUrl: "https://github.com/hzrd149/wok",
      ownerPubkey:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      repoName: "wok",
    });
    expect(r?.preferApi).toBe(true);
    expect(r?.primarySrc).toBe("");
    expect(r?.repoPath).toBe("docs/wok.svg");
    expect(r?.ownerPubkey).toHaveLength(64);
  });

  it("uses same-origin API for Nostr/GRASP clones (no invented /raw/)", () => {
    const r = resolveReadmeMarkdownImage({
      src: "docs/assets/dashboard-map.png",
      branch: "main",
      cloneUrls: ["https://git.gittr.space/npub1abcxyz/lab-kit.git"],
      ownerPubkey:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      repoName: "lab-kit",
    });
    expect(r).not.toBeNull();
    expect(r!.preferApi).toBe(true);
    expect(r!.primarySrc).toBe("");
    expect(r!.repoPath).toBe("docs/assets/dashboard-map.png");
    expect(r!.sourceUrl).toContain("git.gittr.space");
    expect(r!.primarySrc.includes("/raw/")).toBe(false);
  });

  it("falls back to ownerPubkey+repo when no clone URL", () => {
    const r = resolveReadmeMarkdownImage({
      src: "docs/assets/board.png",
      branch: "master",
      ownerPubkey:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      repoName: "lab-kit",
    });
    expect(r?.preferApi).toBe(true);
    expect(r?.ownerPubkey).toHaveLength(64);
    expect(r?.repoName).toBe("lab-kit");
  });

  it("returns null when relative and no fetch identity", () => {
    expect(
      resolveReadmeMarkdownImage({
        src: "docs/assets/x.png",
        branch: "main",
      })
    ).toBeNull();
  });
});
