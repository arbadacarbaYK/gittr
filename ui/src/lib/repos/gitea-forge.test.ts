import { describe, expect, it } from "vitest";

import { giteaApiRepoBase, parseGiteaCompatibleRepo } from "./gitea-forge";

describe("parseGiteaCompatibleRepo", () => {
  it("parses Codeberg", () => {
    const p = parseGiteaCompatibleRepo(
      "https://codeberg.org/forgejo/forgejo.git"
    );
    expect(p).toEqual({
      origin: "https://codeberg.org",
      host: "codeberg.org",
      owner: "forgejo",
      repo: "forgejo",
      kind: "codeberg",
    });
    expect(giteaApiRepoBase(p!)).toBe(
      "https://codeberg.org/api/v1/repos/forgejo/forgejo"
    );
  });

  it("parses a Forgejo-named host", () => {
    const p = parseGiteaCompatibleRepo(
      "https://git.forgejo.example/org/app.git"
    );
    expect(p?.kind).toBe("gitea");
    expect(p?.origin).toBe("https://git.forgejo.example");
    expect(p?.owner).toBe("org");
    expect(p?.repo).toBe("app");
  });

  it("parses a typical self-hosted HTTPS owner/repo (try Gitea API)", () => {
    const p = parseGiteaCompatibleRepo("https://git.example.com/alice/notes");
    expect(p?.kind).toBe("gitea");
    expect(p?.host).toBe("git.example.com");
    expect(p?.owner).toBe("alice");
    expect(p?.repo).toBe("notes");
  });

  it("rejects GitHub, GitLab, and GRASP", () => {
    expect(parseGiteaCompatibleRepo("https://github.com/me/gittr")).toBeNull();
    expect(parseGiteaCompatibleRepo("https://gitlab.com/me/gittr")).toBeNull();
    expect(
      parseGiteaCompatibleRepo("https://git.gittr.space/npub1abc/gittr.git")
    ).toBeNull();
  });
});
