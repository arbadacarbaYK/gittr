import { describe, expect, it } from "vitest";

import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  type NostrEventLike,
  gittrRepoPathFromNip34A,
  gittrRepoPathFromRepositoryUrl,
  parseSoftwareApp,
  parseSoftwareAsset,
  safeHttpUrlTag,
} from "./nip82-software";

const appEvent = (tags: string[][]): NostrEventLike => ({
  id: "e".repeat(64),
  pubkey: "a".repeat(64),
  kind: KIND_SOFTWARE_APPLICATION,
  created_at: 1,
  content: "",
  tags: [["d", "app.id"], ["name", "App"], ...tags],
});

describe("safeHttpUrlTag", () => {
  it("allows http(s) only", () => {
    expect(safeHttpUrlTag("https://example.com/x")).toBe(
      "https://example.com/x"
    );
    expect(safeHttpUrlTag("http://example.com")).toBe("http://example.com/");
    expect(safeHttpUrlTag("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrlTag("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHttpUrlTag("vbscript:x")).toBeUndefined();
    expect(safeHttpUrlTag("file:///etc/passwd")).toBeUndefined();
    expect(safeHttpUrlTag("not a url")).toBeUndefined();
    expect(safeHttpUrlTag("")).toBeUndefined();
    expect(safeHttpUrlTag(undefined)).toBeUndefined();
  });

  it("rejects userinfo tricks", () => {
    expect(safeHttpUrlTag("https://user:pass@evil.com")).toBeUndefined();
  });
});

describe("parseSoftwareApp URL sanitizing", () => {
  it("drops javascript: url/icon/repository from hostile events", () => {
    const parsed = parseSoftwareApp(
      appEvent([
        ["url", "javascript:alert(document.cookie)"],
        ["icon", "data:text/html,<script>x</script>"],
        ["repository", "vbscript:evil"],
      ])
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.webUrl).toBeUndefined();
    expect(parsed?.icon).toBeUndefined();
    expect(parsed?.repository).toBeUndefined();
  });

  it("keeps legit https urls", () => {
    const parsed = parseSoftwareApp(
      appEvent([
        ["url", "https://app.example.com"],
        ["icon", "https://cdn.example.com/icon.png"],
        ["repository", "https://github.com/org/repo"],
      ])
    );
    expect(parsed?.webUrl).toBe("https://app.example.com/");
    expect(parsed?.icon).toBe("https://cdn.example.com/icon.png");
    expect(parsed?.repository).toBe("https://github.com/org/repo");
  });
});

describe("gittrRepoPath from NIP-82 apps", () => {
  const hex = "aa".repeat(32);

  it("builds /{npub}/{repo} from a 30617 a-tag", () => {
    const expected = gittrRepoPathFromNip34A(`30617:${hex}:cargo-limit`);
    expect(expected).toMatch(/^\/npub1[a-z0-9]+\/cargo-limit$/);
    const parsed = parseSoftwareApp(
      appEvent([["a", `30617:${hex}:cargo-limit`]])
    );
    expect(parsed?.gittrRepoPath).toBe(expected);
  });

  it("uses a gittr.space repository URL when there is no a-tag", () => {
    const npub = "npub1abc";
    expect(
      gittrRepoPathFromRepositoryUrl(`https://gittr.space/${npub}/demo`)
    ).toBe(`/${npub}/demo`);
    expect(gittrRepoPathFromRepositoryUrl("https://github.com/org/repo")).toBe(
      null
    );
    expect(
      gittrRepoPathFromRepositoryUrl("https://pages.gittr.space/npub1x/demo")
    ).toBe(null);
  });

  it("ignores hostile or empty a-tags", () => {
    expect(gittrRepoPathFromNip34A("30617:nothex:repo")).toBe(null);
    expect(gittrRepoPathFromNip34A(`30617:${hex}:a/b`)).toBe(null);
  });
});

describe("parseSoftwareAsset URL sanitizing", () => {
  it("drops non-http download urls", () => {
    const parsed = parseSoftwareAsset({
      id: "f".repeat(64),
      pubkey: "a".repeat(64),
      kind: KIND_SOFTWARE_ASSET,
      created_at: 1,
      content: "",
      tags: [
        ["m", "application/vnd.android.package-archive"],
        ["x", "b".repeat(64)],
        ["url", "javascript:alert(1)"],
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.url).toBeUndefined();
  });
});
