import { describe, expect, it } from "vitest";

import {
  fileHasInlineBody,
  localExtrasAreHollowOnly,
  overlayLocalBodiesOnRemoteTree,
} from "./file-inline-body";
import { overrideIdbMarker } from "./overrides-idb";

describe("fileHasInlineBody", () => {
  it("treats path-only rows as hollow", () => {
    expect(fileHasInlineBody({ path: "dist/frame-00.png" })).toBe(false);
    expect(
      fileHasInlineBody({ path: "README.md", content: "", data: "   " })
    ).toBe(false);
  });

  it("treats text, data, and IDB markers as bodies", () => {
    expect(fileHasInlineBody({ path: "README.md", content: "# hi" })).toBe(
      true
    );
    expect(fileHasInlineBody({ path: "a.bin", data: "AAAA" })).toBe(true);
    expect(
      fileHasInlineBody({
        path: "shot.gif",
        content: overrideIdbMarker("image/gif"),
      })
    ).toBe(true);
  });
});

describe("localExtrasAreHollowOnly", () => {
  const remote = [
    { path: "README.md", content: "# remote" },
    { path: "index.html" },
  ];

  it("is true when extra local paths have no bytes", () => {
    expect(
      localExtrasAreHollowOnly(
        [
          ...remote,
          { path: "dist/frame-00.png" },
          { path: "dist/interval-16x9.mp4", size: 12 },
        ],
        remote
      )
    ).toBe(true);
  });

  it("is false when a local-only path has a body", () => {
    expect(
      localExtrasAreHollowOnly(
        [...remote, { path: "notes.md", content: "draft" }],
        remote
      )
    ).toBe(false);
  });

  it("is true when there are no extras", () => {
    expect(localExtrasAreHollowOnly(remote, remote)).toBe(true);
  });
});

describe("overlayLocalBodiesOnRemoteTree", () => {
  it("drops hollow extras and keeps remote as the base", () => {
    const remote = [
      { path: "README.md", content: "# forge" },
      { path: "index.html", content: "<html>" },
    ];
    const local = [
      { path: "README.md", content: "# stale cache" },
      { path: "index.html", content: "<html>" },
      { path: "dist/frame-00.png" },
    ];
    const out = overlayLocalBodiesOnRemoteTree(remote, local);
    expect(out.map((f) => f.path).sort()).toEqual(["README.md", "index.html"]);
    expect(out.find((f) => f.path === "README.md")?.content).toBe("# forge");
  });

  it("keeps local-only uploads with bodies and override paths", () => {
    const remote = [{ path: "README.md", content: "# forge" }];
    const local = [
      { path: "README.md", content: "# pages block" },
      { path: "slides/deck.md", content: "# talk" },
      { path: "dist/x.png" },
    ];
    const out = overlayLocalBodiesOnRemoteTree(remote, local, ["README.md"]);
    expect(out.find((f) => f.path === "README.md")?.content).toBe(
      "# pages block"
    );
    expect(out.find((f) => f.path === "slides/deck.md")?.content).toBe(
      "# talk"
    );
    expect(out.some((f) => f.path === "dist/x.png")).toBe(false);
  });
});
