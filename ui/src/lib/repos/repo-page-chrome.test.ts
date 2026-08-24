import { describe, expect, it } from "vitest";

import {
  cloneSourceUrlIsUsable,
  firstSuccessfulSourceKey,
  folderReadmeFallbackPath,
  folderReadmeLoadPath,
  repoPageChromeSignature,
  storedGithubSourceUnchanged,
} from "./repo-page-chrome";

describe("repoPageChromeSignature", () => {
  it("is identical for two objects with the same chrome fields", () => {
    const a = {
      repo: "ambersocket",
      lastNostrEventId: "a".repeat(64),
      sourceUrl: "https://github.com/acme/ambersocket",
      clone: ["https://grasp.t5.st/npub1abc/ambersocket.git"],
      publicRead: true,
      forks: 1,
      stars: 0,
    };
    const b = { ...a, readme: "# hello", files: [{ path: "README.md" }] };
    expect(repoPageChromeSignature(a)).toBe(repoPageChromeSignature(b));
  });

  it("changes when clone or event id changes", () => {
    const base = { repo: "x", clone: ["https://a.example/x.git"] };
    expect(repoPageChromeSignature(base)).not.toBe(
      repoPageChromeSignature({
        ...base,
        clone: ["https://a.example/x.git", "https://b.example/x.git"],
      })
    );
    expect(repoPageChromeSignature(base)).not.toBe(
      repoPageChromeSignature({ ...base, lastNostrEventId: "b".repeat(64) })
    );
  });
});

describe("firstSuccessfulSourceKey", () => {
  it("stays stable when later sources are appended", () => {
    const first = {
      sourceUrl: "https://grasp.t5.st/npub1abc/repo.git",
      resolvedBranch: "master",
    };
    const one = firstSuccessfulSourceKey([first], "main");
    const two = firstSuccessfulSourceKey(
      [first, { sourceUrl: "https://github.com/acme/repo.git" }],
      "main"
    );
    expect(one).toBe(two);
    expect(one).toContain("grasp.t5.st");
  });

  it("is empty without a first clone URL", () => {
    expect(firstSuccessfulSourceKey([], "main")).toBe("");
    expect(firstSuccessfulSourceKey(undefined, "main")).toBe("");
  });
});

describe("folderReadmeFallbackPath", () => {
  it("uses the listed tree path when present", () => {
    expect(folderReadmeFallbackPath("docs/README.md", "")).toBe(
      "docs/README.md"
    );
  });

  it("defaults to README.md at the current folder", () => {
    expect(folderReadmeFallbackPath("", "")).toBe("README.md");
    expect(folderReadmeFallbackPath("", "src/lib")).toBe("src/lib/README.md");
  });
});

describe("folderReadmeLoadPath", () => {
  it("fetches README from a known winner before any listing exists", () => {
    expect(
      folderReadmeLoadPath({
        listedPath: "",
        currentPath: "",
        hasWinner: true,
        hasListing: false,
      })
    ).toBe("README.md");
  });

  it("does not 404 README after a listing that has no README row", () => {
    expect(
      folderReadmeLoadPath({
        listedPath: "",
        currentPath: "src",
        hasWinner: true,
        hasListing: true,
      })
    ).toBe("");
  });
});

describe("cloneSourceUrlIsUsable", () => {
  it("accepts https clones and skips bare http IPs", () => {
    expect(
      cloneSourceUrlIsUsable("https://grasp.t5.st/npub1abc/repo.git")
    ).toBe(true);
    expect(cloneSourceUrlIsUsable("http://192.168.1.5:8080/repo.git")).toBe(
      false
    );
    expect(cloneSourceUrlIsUsable("")).toBe(false);
  });
});

describe("storedGithubSourceUnchanged", () => {
  it("is true when source, clone, and forkedFrom match", () => {
    const row = {
      sourceUrl: "https://github.com/acme/widgets",
      clone: ["https://github.com/acme/widgets.git"],
    };
    expect(storedGithubSourceUnchanged(row, { ...row })).toBe(true);
    expect(
      storedGithubSourceUnchanged(row, {
        ...row,
        clone: [
          "https://github.com/acme/widgets.git",
          "https://extra.example/x.git",
        ],
      })
    ).toBe(false);
  });
});
