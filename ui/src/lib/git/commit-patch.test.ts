import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseUnifiedCommitDiff,
  readBareCommitDiff,
  sanitizeCommitBranchName,
  sanitizeCommitSha,
} from "./commit-patch";

describe("sanitizeCommitSha", () => {
  it("accepts hex and rejects revisions", () => {
    expect(sanitizeCommitSha("f26f89d")).toBe("f26f89d");
    expect(sanitizeCommitSha("F26F89D6A5781E424E01C697CF63011EED14F42A")).toBe(
      "f26f89d6a5781e424e01c697cf63011eed14f42a"
    );
    expect(sanitizeCommitSha("HEAD")).toBe(null);
    expect(sanitizeCommitSha("master..ban-descendants")).toBe(null);
    expect(sanitizeCommitSha("abcdefg")).toBe(null);
  });
});

describe("sanitizeCommitBranchName", () => {
  it("keeps a feature branch and rejects range syntax", () => {
    expect(sanitizeCommitBranchName("ban-descendants")).toBe("ban-descendants");
    expect(sanitizeCommitBranchName("Downsize+FOSS")).toBe("Downsize+FOSS");
    expect(sanitizeCommitBranchName("release/0.3.0")).toBe("release/0.3.0");
    expect(sanitizeCommitBranchName("main..dev")).toBe(null);
    expect(sanitizeCommitBranchName("-master")).toBe(null);
    expect(sanitizeCommitBranchName("refs/heads/main")).toBe(null);
  });
});

describe("parseUnifiedCommitDiff", () => {
  it("splits added, modified, deleted, rename, and binary files", () => {
    const patch = [
      "diff --git a/src/A.cs b/src/A.cs",
      "index 1111111..2222222 100644",
      "--- a/src/A.cs",
      "+++ b/src/A.cs",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "diff --git a/src/B.cs b/src/B.cs",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/B.cs",
      "@@ -0,0 +1 @@",
      "+hello",
      "diff --git a/src/C.cs b/src/C.cs",
      "deleted file mode 100644",
      "--- a/src/C.cs",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      'diff --git "a/my file.txt" "b/my file.txt"',
      "similarity index 100%",
      "rename from my file.txt",
      "rename to my file.txt",
      "diff --git a/pic.png b/pic.png",
      "index 111..222",
      "Binary files a/pic.png and b/pic.png differ",
    ].join("\n");

    const files = parseUnifiedCommitDiff(patch);
    expect(
      files.map((f) => [f.path, f.status, f.additions, f.deletions])
    ).toEqual([
      ["src/A.cs", "modified", 1, 1],
      ["src/B.cs", "added", 1, 0],
      ["src/C.cs", "deleted", 0, 1],
      ["my file.txt", "modified", 0, 0],
      ["pic.png", "modified", 0, 0],
    ]);
    expect(files[0]?.patch?.startsWith("diff --git a/src/A.cs")).toBe(true);
    expect(files[4]?.isBinary).toBe(true);
    expect(files[4]?.patch).toBeUndefined();
  });
});

describe("readBareCommitDiff", () => {
  it("returns the feature-branch patch and refuses the same commit on master", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gittr-commit-patch-"));
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      })
        .toString()
        .trim();

    try {
      git(["init", "-b", "master"]);
      writeFileSync(join(dir, "a.txt"), "one\n");
      git(["add", "a.txt"]);
      git(["commit", "-m", "base"]);
      const masterSha = git(["rev-parse", "HEAD"]);

      git(["checkout", "-b", "ban-descendants"]);
      writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
      writeFileSync(join(dir, "b.txt"), "new\n");
      git(["add", "a.txt", "b.txt"]);
      git(["commit", "-m", "CR"]);
      const featureSha = git(["rev-parse", "HEAD"]);

      const gitDir = join(dir, ".git");
      const onBranch = await readBareCommitDiff({
        repoPath: gitDir,
        sha: featureSha.slice(0, 7),
        branch: "ban-descendants",
      });
      expect(onBranch.ok).toBe(true);
      if (!onBranch.ok) return;
      expect(onBranch.sha).toBe(featureSha);
      expect(onBranch.branch).toBe("ban-descendants");
      expect(onBranch.files.map((f) => `${f.status}:${f.path}`).sort()).toEqual(
        ["added:b.txt", "modified:a.txt"]
      );

      const wrongBranch = await readBareCommitDiff({
        repoPath: gitDir,
        sha: featureSha,
        branch: "master",
      });
      expect(wrongBranch).toMatchObject({
        ok: false,
        code: "not_on_branch",
      });

      const missingBranch = await readBareCommitDiff({
        repoPath: gitDir,
        sha: featureSha,
        branch: "no-such-branch",
      });
      expect(missingBranch).toMatchObject({
        ok: false,
        code: "missing_branch",
      });

      const onMaster = await readBareCommitDiff({
        repoPath: gitDir,
        sha: masterSha,
        branch: "master",
      });
      expect(onMaster.ok).toBe(true);
      if (!onMaster.ok) return;
      expect(onMaster.files.some((f) => f.path === "b.txt")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
