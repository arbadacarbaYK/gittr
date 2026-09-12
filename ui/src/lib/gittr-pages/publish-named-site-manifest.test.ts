import { describe, expect, it } from "vitest";

import { isGittrPagesManifestPath } from "./pages-manifest-paths";

describe("isGittrPagesManifestPath", () => {
  it("keeps the docs hub files", () => {
    expect(isGittrPagesManifestPath("index.html")).toBe(true);
    expect(isGittrPagesManifestPath("docs-site/hub.css")).toBe(true);
    expect(isGittrPagesManifestPath("docs-site/hub.js")).toBe(true);
    expect(isGittrPagesManifestPath("docs/gittr-platform.gif")).toBe(true);
    expect(isGittrPagesManifestPath("README.md")).toBe(true);
  });

  it("keeps helper-tools snippets (no ui/ tree)", () => {
    expect(isGittrPagesManifestPath("snippets/announce.ts")).toBe(true);
    expect(isGittrPagesManifestPath("cookbook/demo.tsx")).toBe(true);
  });

  it("skips the gittr forge / app trees so Push Manifest is not 800 ui files", () => {
    expect(isGittrPagesManifestPath("ui/src/app/page.tsx")).toBe(false);
    expect(
      isGittrPagesManifestPath("ui/src/components/repo/RepoCodePage.tsx")
    ).toBe(false);
    expect(
      isGittrPagesManifestPath("android-app/app/src/main/AndroidManifest.xml")
    ).toBe(false);
    expect(isGittrPagesManifestPath("infra/nsite-gateway/README.md")).toBe(
      false
    );
    expect(isGittrPagesManifestPath("scripts/upload_to_hetzner.sh")).toBe(
      false
    );
    expect(isGittrPagesManifestPath(".github/workflows/ci.yml")).toBe(false);
  });

  it("skips nested build/vendor folders even when not at the repo root", () => {
    expect(isGittrPagesManifestPath("docs/node_modules/foo.js")).toBe(false);
    expect(isGittrPagesManifestPath("site/.next/static/chunk.js")).toBe(false);
  });
});
