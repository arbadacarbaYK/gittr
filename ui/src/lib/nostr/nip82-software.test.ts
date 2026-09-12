import { describe, expect, it } from "vitest";

import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  type NostrEventLike,
  gittrRepoPathFromNip34A,
  gittrRepoPathFromRepositoryUrl,
  normalizeSoftwareIconUrl,
  parseSoftwareApp,
  parseSoftwareAsset,
  preferOwnerSoftwareApps,
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

  it("uses image tag when icon is missing", () => {
    const parsed = parseSoftwareApp(
      appEvent([["image", "https://cdn.example.com/from-image.png"]])
    );
    expect(parsed?.icon).toBe("https://cdn.example.com/from-image.png");
  });

  it("prefers icon over image", () => {
    const parsed = parseSoftwareApp(
      appEvent([
        ["icon", "https://cdn.example.com/icon.png"],
        ["image", "https://cdn.example.com/from-image.png"],
      ])
    );
    expect(parsed?.icon).toBe("https://cdn.example.com/icon.png");
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

  it("drops dead Zapstore CDN icon hosts", () => {
    const parsed = parseSoftwareApp(
      appEvent([
        [
          "icon",
          "https://cdn.zap.store/f23a57ab74701f783f13c56d1398fd192b6cff784150cc3f854d999002b32a86.webp",
        ],
      ])
    );
    expect(parsed?.icon).toBeUndefined();
    expect(
      normalizeSoftwareIconUrl(
        "https://cdn.zapstore.dev/dee157a2c82467208087ec333ee1c53bd28caf33efb0c725b14460dbbc6b1b47"
      )
    ).toBe(
      "https://cdn.zapstore.dev/dee157a2c82467208087ec333ee1c53bd28caf33efb0c725b14460dbbc6b1b47"
    );
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

describe("preferOwnerSoftwareApps", () => {
  const owner = "aa".repeat(32);
  const zapstore = "bb".repeat(32);

  const listing = (
    pubkey: string,
    appId: string,
    createdAt: number,
    extra: string[][] = []
  ): ReturnType<typeof parseSoftwareApp> =>
    parseSoftwareApp({
      id: "e".repeat(64),
      pubkey,
      kind: KIND_SOFTWARE_APPLICATION,
      created_at: createdAt,
      content: "",
      tags: [["d", appId], ["name", appId], ...extra],
    });

  it("keeps the owner's 32267 and drops a Zapstore #p republication", () => {
    const owned = listing(owner, "com.greenart7c3.amber", 20, [
      ["icon", "https://cdn.zapstore.dev/abc"],
    ]);
    const republish = listing(zapstore, "com.greenart7c3.amber", 10, [
      ["p", owner],
      [
        "icon",
        "https://cdn.zap.store/f23a57ab74701f783f13c56d1398fd192b6cff784150cc3f854d999002b32a86.webp",
      ],
    ]);
    const other = listing(owner, "com.greenart7c3.morganite", 15);
    expect(owned && republish && other).toBeTruthy();
    const out = preferOwnerSoftwareApps([owned!, republish!, other!], owner);
    expect(out.map((a) => a.appId).sort()).toEqual([
      "com.greenart7c3.amber",
      "com.greenart7c3.morganite",
    ]);
    const amber = out.find((a) => a.appId.includes("amber"));
    expect(amber?.pubkey).toBe(owner);
    expect(amber?.icon).toBe("https://cdn.zapstore.dev/abc");
  });

  it("keeps an attributed listing when the owner never published that id", () => {
    const onlyZap = listing(zapstore, "com.example.onlyzap", 5, [
      ["p", owner],
      ["icon", "https://cdn.example.com/ok.png"],
    ]);
    expect(onlyZap).not.toBeNull();
    const out = preferOwnerSoftwareApps([onlyZap!], owner);
    expect(out).toHaveLength(1);
    expect(out[0]?.pubkey).toBe(zapstore);
    expect(out[0]?.icon).toBe("https://cdn.example.com/ok.png");
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
