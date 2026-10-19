import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  GITTR_APP_OG_CARD_REV,
  appOgAuthorLabel,
  appOgImagePath,
  formatAppOgCount,
  indexNewestApps,
  parseAppGithubRepo,
  shapeAppOgCard,
} from "./app-og-card";

const PK = "ab".repeat(32);

describe("appOgImagePath", () => {
  it("points each package at its own card and leaves the hub splash for /apps", () => {
    expect(appOgImagePath("io.github.jooray.localhoststudio")).toBe(
      `/apps/io.github.jooray.localhoststudio/opengraph-image?v=${GITTR_APP_OG_CARD_REV}`
    );
    expect(appOgImagePath("mine")).toBe("/apps/opengraph-image");
    expect(appOgImagePath("")).toBe("/apps/opengraph-image");
  });
});

describe("shapeAppOgCard", () => {
  it("keeps the listing facts that fit on a share card", () => {
    const card = shapeAppOgCard(
      {
        appId: "io.github.jooray.localhoststudio",
        name: "Localhost Recording Studio",
        summary:
          "Make full songs from a style and lyrics, offline, on your phone.",
        icon: "https://cdn.example/icon.webp",
        license: "MIT",
        topics: ["music", "audio", "Music"],
        platformHints: ["android-arm64-v8a"],
        pubkey: PK,
        repository: "https://github.com/jooray/localhoststudio.git",
        createdAt: 10,
      },
      "io.github.jooray.localhoststudio"
    );
    expect(card.name).toBe("Localhost Recording Studio");
    expect(card.showAppId).toBe(true);
    expect(card.appId).toBe("io.github.jooray.localhoststudio");
    expect(card.description).toMatch(/offline/);
    expect(card.license).toBe("MIT");
    expect(card.tags).toEqual(["music", "audio", "Android"]);
    expect(card.iconUrl).toBe("https://cdn.example/icon.webp");
    expect(card.github).toEqual({
      owner: "jooray",
      repo: "localhoststudio",
    });
    expect(card.pubkey).toBe(PK);
  });

  it("drops dead icon hosts, svg icons, and non-github forges", () => {
    const card = shapeAppOgCard(
      {
        appId: "sh.fhs.ksre",
        name: "Katawa",
        icon: "https://cdn.zap.store/dead.webp",
        repository: "https://codeberg.org/fhs/katawa",
        topics: ["visual novel"],
      },
      "sh.fhs.ksre"
    );
    expect(card.iconUrl).toBeNull();
    expect(card.github).toBeNull();
    expect(card.tags).toEqual(["visual novel"]);
    expect(
      shapeAppOgCard(
        { appId: "a", name: "A", icon: "https://cdn.example/logo.svg" },
        "a"
      ).iconUrl
    ).toBeNull();
  });

  it("uses the package id when the catalog has no name, and clips a long summary", () => {
    const missing = shapeAppOgCard(null, "com.example.app");
    expect(missing.name).toBe("com.example.app");
    expect(missing.showAppId).toBe(false);
    expect(missing.description).toBeNull();
    expect(missing.pubkey).toBeNull();

    const long = shapeAppOgCard(
      { appId: "a", name: "A", summary: "word ".repeat(80) },
      "a"
    );
    expect(long.description?.endsWith("…")).toBe(true);
    expect((long.description || "").length).toBeLessThanOrEqual(180);
  });
});

describe("indexNewestApps", () => {
  it("keeps the newest event per package id and skips mine", () => {
    const index = indexNewestApps([
      { appId: "mine", name: "Nope", createdAt: 9 },
      { appId: "space.gittr.app", name: "old", createdAt: 1 },
      { appId: "space.gittr.app", name: "new", createdAt: 5, license: "MIT" },
    ]);
    expect(index.has("mine")).toBe(false);
    expect(index.get("space.gittr.app")?.name).toBe("new");
    expect(index.get("space.gittr.app")?.license).toBe("MIT");
  });
});

describe("appOgAuthorLabel", () => {
  it("prefers a profile name and nip05, then a short npub", () => {
    expect(
      appOgAuthorLabel(
        { display_name: "Juraj", nip05: "juraj@tamersofentropy.net" },
        PK
      )
    ).toBe("Juraj · juraj@tamersofentropy.net");
    expect(appOgAuthorLabel(null, PK)).toBe(
      `${nip19.npubEncode(PK).slice(0, 12)}…`
    );
    expect(appOgAuthorLabel({ name: "npub1whatever" }, PK)).toBe(
      `${nip19.npubEncode(PK).slice(0, 12)}…`
    );
    expect(appOgAuthorLabel(null, null)).toBe("Nostr app");
  });
});

describe("parseAppGithubRepo", () => {
  it("accepts https and git@ github urls", () => {
    expect(parseAppGithubRepo("git@github.com:Org/Repo.git")).toEqual({
      owner: "Org",
      repo: "Repo",
    });
    expect(parseAppGithubRepo("https://gitlab.com/org/repo")).toBeNull();
  });
});

describe("formatAppOgCount", () => {
  it("matches the repo card’s short counts", () => {
    expect(formatAppOgCount(27)).toBe("27");
    expect(formatAppOgCount(1200)).toBe("1.2k");
  });
});
