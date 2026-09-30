import { describe, expect, it } from "vitest";

import {
  blockEmptyRepositoryState,
  blockPushWhenFileBytesMissing,
} from "./push-empty-guard";

describe("blockPushWhenFileBytesMissing", () => {
  it("stops a push that lists files but has no contents", () => {
    expect(
      blockPushWhenFileBytesMissing({
        deferToBridgeSourceClone: false,
        filesWithContent: 0,
        namedFileCount: 12,
      })
    ).toBe(true);
  });

  it("allows a push that has file contents", () => {
    expect(
      blockPushWhenFileBytesMissing({
        deferToBridgeSourceClone: false,
        filesWithContent: 3,
        namedFileCount: 12,
      })
    ).toBe(false);
  });

  it("allows a forge import that the bridge clones itself", () => {
    expect(
      blockPushWhenFileBytesMissing({
        deferToBridgeSourceClone: true,
        filesWithContent: 0,
        namedFileCount: 40,
      })
    ).toBe(false);
  });

  it("allows a metadata update that has no file list in the browser", () => {
    expect(
      blockPushWhenFileBytesMissing({
        deferToBridgeSourceClone: false,
        filesWithContent: 0,
        namedFileCount: 0,
      })
    ).toBe(false);
  });
});

describe("blockEmptyRepositoryState", () => {
  it("refuses a branch pointer with no commit", () => {
    expect(blockEmptyRepositoryState(0)).toBe(true);
  });

  it("allows a branch pointer that names a commit", () => {
    expect(blockEmptyRepositoryState(1)).toBe(false);
  });
});
