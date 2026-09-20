import { describe, expect, it } from "vitest";

import {
  GITTR_DOC_README,
  GITTR_DOC_README_PATH,
  GITTR_OWNER_NPUB,
  gittrRepoFile,
  gittrRepoFilePath,
} from "./gittr-repo-links";

describe("gittr repo file links", () => {
  it("keeps an absolute URL for docs and a same-origin path for in-app nav", () => {
    expect(GITTR_DOC_README).toBe(
      `https://gittr.space/${GITTR_OWNER_NPUB}/gittr?file=README.md&branch=main`
    );
    expect(GITTR_DOC_README_PATH).toBe(
      `/${GITTR_OWNER_NPUB}/gittr?file=README.md&branch=main`
    );
    expect(gittrRepoFilePath("gittr", "docs/SEO.md")).toBe(
      gittrRepoFile("gittr", "docs/SEO.md").replace("https://gittr.space", "")
    );
  });
});
