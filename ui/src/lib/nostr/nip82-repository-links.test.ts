import { describe, expect, it } from "vitest";

import {
  repositoryUrlToReleasesHref,
  repositoryUrlToSourceHref,
  softwareAppCardLinks,
} from "./nip82-repository-links";

describe("repositoryUrlToSourceHref", () => {
  it("keeps a GitHub tree URL instead of sending people to /releases", () => {
    expect(
      repositoryUrlToSourceHref("https://github.com/Peach2Peach/peach-app")
    ).toBe("https://github.com/Peach2Peach/peach-app");
    expect(repositoryUrlToSourceHref("https://github.com/org/repo.git")).toBe(
      "https://github.com/org/repo"
    );
  });

  it("turns git@ into https", () => {
    expect(repositoryUrlToSourceHref("git@github.com:org/repo.git")).toBe(
      "https://github.com/org/repo"
    );
  });
});

describe("softwareAppCardLinks", () => {
  it("uses the Zapstore repository tag as Repo so the source can be audited", () => {
    const links = softwareAppCardLinks({
      repository: "https://github.com/Peach2Peach/peach-app",
    });
    expect(links.repoHref).toBe("https://github.com/Peach2Peach/peach-app");
    expect(links.repoIsExternal).toBe(true);
    expect(links.releasesHref).toBe(
      "https://github.com/Peach2Peach/peach-app/releases"
    );
  });

  it("prefers a gittr Code path when the announce also has a NIP-34 pointer", () => {
    const links = softwareAppCardLinks({
      gittrRepoPath:
        "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr",
      repository: "https://github.com/arbadacarbaYK/gittr",
      webUrl: "https://gittr.space/",
    });
    expect(links.repoHref).toBe(
      "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr"
    );
    expect(links.repoIsExternal).toBe(false);
    expect(links.releasesHref).toBe(
      "https://github.com/arbadacarbaYK/gittr/releases"
    );
    expect(links.webHref).toBe("https://gittr.space/");
  });

  it("does not show a duplicate Releases button when the host has no releases page", () => {
    const url = "https://example.com/some-app";
    expect(repositoryUrlToReleasesHref(url)).toBe(url);
    const links = softwareAppCardLinks({ repository: url });
    expect(links.repoHref).toBe(url);
    expect(links.releasesHref).toBeUndefined();
  });
});
