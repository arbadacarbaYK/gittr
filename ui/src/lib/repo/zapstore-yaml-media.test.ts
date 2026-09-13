import { describe, expect, it } from "vitest";

import {
  parseHttpsUrlLines,
  parseZapstoreYamlMedia,
  resolveZapstoreMediaHttps,
  zapstoreYamlCandidateRawUrls,
} from "./zapstore-yaml-media";

const SAMPLE = `
# Zapstore whitelist
name: demo
icon: ./assets/icon.png
images:
  - ./screenshots/home.png
  - https://cdn.example.com/shot-repo.png
  - "docs/shots/settings.png"
pubkey: npub1abc
`;

describe("parseZapstoreYamlMedia", () => {
  it("reads icon and images list (paths or URLs)", () => {
    expect(parseZapstoreYamlMedia(SAMPLE)).toEqual({
      icon: "./assets/icon.png",
      images: [
        "./screenshots/home.png",
        "https://cdn.example.com/shot-repo.png",
        "docs/shots/settings.png",
      ],
    });
  });

  it("reads a flow-style images list", () => {
    expect(
      parseZapstoreYamlMedia(`images: [a.png, "https://cdn.example.com/b.png"]`)
    ).toEqual({
      icon: undefined,
      images: ["a.png", "https://cdn.example.com/b.png"],
    });
  });

  it("ignores comments and blank lines", () => {
    expect(
      parseZapstoreYamlMedia(`
# images:
#   - skip.png
icon: icon.png # store tile
# Phone screenshots
images:
  - keep.png
`)
    ).toEqual({ icon: "icon.png", images: ["keep.png"] });
  });
});

describe("resolveZapstoreMediaHttps", () => {
  it("rewrites GitHub-relative paths to raw.githubusercontent.com", () => {
    const got = resolveZapstoreMediaHttps({
      media: parseZapstoreYamlMedia(SAMPLE),
      sourceUrl: "https://github.com/acme/demo",
      defaultBranch: "main",
    });
    expect(got.icon).toBe(
      "https://raw.githubusercontent.com/acme/demo/main/assets/icon.png"
    );
    expect(got.screenshots).toEqual([
      "https://raw.githubusercontent.com/acme/demo/main/screenshots/home.png",
      "https://cdn.example.com/shot-repo.png",
      "https://raw.githubusercontent.com/acme/demo/main/docs/shots/settings.png",
    ]);
  });

  it("rewrites Codeberg-relative paths", () => {
    const got = resolveZapstoreMediaHttps({
      media: { images: ["shots/1.png"] },
      sourceUrl: "https://codeberg.org/acme/demo",
      defaultBranch: "master",
    });
    expect(got.screenshots).toEqual([
      "https://codeberg.org/acme/demo/raw/branch/master/shots/1.png",
    ]);
  });

  it("rewrites GitLab-relative paths", () => {
    const got = resolveZapstoreMediaHttps({
      media: { images: ["docs/shot.png"] },
      sourceUrl: "https://gitlab.com/acme/demo",
      defaultBranch: "main",
    });
    expect(got.screenshots).toEqual([
      "https://gitlab.com/acme/demo/-/raw/main/docs/shot.png",
    ]);
  });

  it("rewrites self-hosted Forgejo-relative paths", () => {
    const got = resolveZapstoreMediaHttps({
      media: { images: ["assets/home.png"] },
      sourceUrl: "https://git.example.com/acme/demo",
      defaultBranch: "main",
    });
    expect(got.screenshots).toEqual([
      "https://git.example.com/acme/demo/raw/branch/main/assets/home.png",
    ]);
  });

  it("drops javascript URLs and parent-path traversal", () => {
    const got = resolveZapstoreMediaHttps({
      media: {
        images: ["javascript:alert(1)", "../secret.png", "ok.png"],
      },
      sourceUrl: "https://github.com/acme/demo",
    });
    expect(got.screenshots).toEqual([
      "https://raw.githubusercontent.com/acme/demo/main/ok.png",
    ]);
  });

  it("lists candidate raw URLs for the repo-root yaml", () => {
    expect(
      zapstoreYamlCandidateRawUrls({
        sourceUrl: "https://github.com/acme/demo",
        defaultBranch: "main",
      })
    ).toEqual([
      "https://raw.githubusercontent.com/acme/demo/main/zapstore.yaml",
      "https://raw.githubusercontent.com/acme/demo/main/zapstore.yml",
      "https://raw.githubusercontent.com/acme/demo/master/zapstore.yaml",
      "https://raw.githubusercontent.com/acme/demo/master/zapstore.yml",
    ]);
  });
});

describe("parseHttpsUrlLines", () => {
  it("keeps unique http(s) lines", () => {
    expect(
      parseHttpsUrlLines(`
https://cdn.example.com/a.png
not-a-url
https://cdn.example.com/a.png
https://cdn.example.com/b.png
`)
    ).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png",
    ]);
  });
});
