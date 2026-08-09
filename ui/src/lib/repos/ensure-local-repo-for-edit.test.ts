import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchBridge = vi.fn();
const mockLoadStored = vi.fn(() => [] as any[]);
const mockSaveStored = vi.fn(() => true);
const mockLoadFiles = vi.fn(() => [] as any[]);
const mockSaveFiles = vi.fn(() => true);
const mockFind = vi.fn(() => null as any);

vi.mock("../utils/git-source-fetcher", () => ({
  fetchBridgeFilesOnce: (...args: unknown[]) => mockFetchBridge(...args),
}));

vi.mock("../utils/repo-finder", () => ({
  findRepoByEntityAndName: (...args: unknown[]) => mockFind(...args),
}));

vi.mock("./storage", () => ({
  loadStoredRepos: () => mockLoadStored(),
  saveStoredRepos: (...args: unknown[]) => mockSaveStored(...args),
  loadRepoFiles: (...args: unknown[]) => mockLoadFiles(...args),
  saveRepoFiles: (...args: unknown[]) => mockSaveFiles(...args),
}));

import { ensureLocalRepoForEdit } from "./ensure-local-repo-for-edit";

const OWNER =
  "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
const ENTITY =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

describe("ensureLocalRepoForEdit", () => {
  beforeEach(() => {
    mockFetchBridge.mockReset();
    mockLoadStored.mockReset().mockReturnValue([]);
    mockSaveStored.mockReset().mockReturnValue(true);
    mockLoadFiles.mockReset().mockReturnValue([]);
    mockSaveFiles.mockReset().mockReturnValue(true);
    mockFind.mockReset().mockReturnValue(null);
  });

  it("creates a local shell when the repo is missing", async () => {
    mockFetchBridge.mockResolvedValue({ files: [] });
    // After create, find returns the shell on the second load for hydrate path
    mockFind
      .mockReturnValueOnce(null)
      .mockReturnValue({ entity: ENTITY, repo: "local-agent", ownerPubkey: OWNER });

    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(result.ok).toBe(true);
    expect(result.createdShell).toBe(true);
    expect(mockSaveStored).toHaveBeenCalled();
  });

  it("hydrates file index from the bridge when local is empty", async () => {
    const shell = {
      entity: ENTITY,
      repo: "local-agent",
      slug: "local-agent",
      ownerPubkey: OWNER,
      hasUnpushedEdits: false,
      fileCount: 0,
    };
    mockFind.mockReturnValue(shell);
    mockLoadStored.mockReturnValue([shell]);
    mockFetchBridge.mockResolvedValue({
      files: [
        { type: "file", path: "README.md", size: 12 },
        { type: "dir", path: "src" },
      ],
      branch: "main",
    });

    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(result.ok).toBe(true);
    expect(result.hydratedFromBridge).toBe(true);
    expect(result.fileCount).toBe(2);
    expect(mockSaveFiles).toHaveBeenCalled();
  });

  it("does not overwrite unpushed local edits with the bridge", async () => {
    mockFind.mockReturnValue({
      entity: ENTITY,
      repo: "local-agent",
      hasUnpushedEdits: true,
      fileCount: 1,
    });
    mockLoadFiles.mockReturnValue([{ path: "mine.txt", type: "file" }]);

    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(result.hydratedFromBridge).toBe(false);
    expect(mockFetchBridge).not.toHaveBeenCalled();
  });

  it("rejects invalid owner pubkey", async () => {
    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "x",
      ownerPubkey: "not-hex",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/owner/i);
  });
});
