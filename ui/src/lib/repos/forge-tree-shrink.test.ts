import { describe, expect, it } from "vitest";

import {
  allowShrinkToSourceUpstreamTree,
  urlLooksLikeSourceUpstream,
} from "./forge-tree-shrink";

describe("urlLooksLikeSourceUpstream", () => {
  it("accepts github gitlab codeberg and gitea-shaped remotes", () => {
    expect(
      urlLooksLikeSourceUpstream("https://github.com/org/repo")
    ).toBe(true);
    expect(
      urlLooksLikeSourceUpstream("https://gitlab.com/group/repo.git")
    ).toBe(true);
    expect(
      urlLooksLikeSourceUpstream("https://codeberg.org/user/repo")
    ).toBe(true);
    expect(
      urlLooksLikeSourceUpstream("https://git.example.com/owner/repo.git")
    ).toBe(true);
    expect(urlLooksLikeSourceUpstream("git@gitea.home:owner/repo.git")).toBe(
      true
    );
  });

  it("rejects GRASP /npub mirrors", () => {
    expect(
      urlLooksLikeSourceUpstream(
        "https://git.gittr.space/npub1abc/repo.git"
      )
    ).toBe(false);
    expect(
      urlLooksLikeSourceUpstream(
        "https://relay.ngit.dev/npub1abc/repo.git"
      )
    ).toBe(false);
  });
});

describe("allowShrinkToSourceUpstreamTree", () => {
  it("allows github shrink when clean", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr-mcp",
        sourceType: "github",
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("allows self-hosted gitea / gitlab SOURCE", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceUrl: "https://git.example.com/owner/repo.git",
        sourceType: "self-hosted-git",
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("allows codeberg SOURCE", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceUrl: "https://codeberg.org/user/repo",
        sourceType: "codeberg",
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("blocks shrink when hasUnpushedEdits", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceUrl: "https://github.com/org/repo",
        sourceType: "github",
        hasUnpushedEdits: true,
      })
    ).toBe(false);
  });

  it("blocks GRASP / nostr-git shrink even when a forge SOURCE exists", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceUrl: "https://github.com/org/repo",
        sourceType: "nostr-git",
        hasUnpushedEdits: false,
      })
    ).toBe(false);
  });

  it("blocks nostr-only (no source/forkedFrom)", () => {
    expect(
      allowShrinkToSourceUpstreamTree({
        sourceType: "github",
        sourceUrl: undefined,
        forkedFrom: undefined,
        clone: ["https://git.gittr.space/npub1abc/repo.git"],
        hasUnpushedEdits: false,
      })
    ).toBe(false);
  });
});
