import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureLocalRepoForEdit } from "./ensure-local-repo-for-edit";

const mockFetchBridge = vi.fn();
const mockLoadStored = vi.fn(() => [] as any[]);
const mockSaveStored = vi.fn(() => true);
const mockLoadFiles = vi.fn(() => [] as any[]);
const mockSaveFiles = vi.fn(() => true);
const mockSaveOverrides = vi.fn(() => true);
const mockSaveDeleted = vi.fn(() => true);
const mockFind = vi.fn(() => null as any);

vi.mock("../utils/git-source-fetcher", () => ({
  fetchBridgeFilesOnce: (...args: unknown[]) => mockFetchBridge(...args),
}));

vi.mock("../utils/repo-finder", () => ({
  findRepoByEntityAndName: (...args: unknown[]) => mockFind(...args),
}));

vi.mock("./deleted-repo-tombstones", () => ({
  clearDeletedRepoTombstones: () => 0,
}));

vi.mock("./storage", () => ({
  loadStoredRepos: () => mockLoadStored(),
  saveStoredRepos: (...args: unknown[]) => mockSaveStored(...args),
  loadRepoFiles: (...args: unknown[]) => mockLoadFiles(...args),
  saveRepoFiles: (...args: unknown[]) => mockSaveFiles(...args),
  saveRepoOverrides: (...args: unknown[]) => mockSaveOverrides(...args),
  saveRepoDeletedPaths: (...args: unknown[]) => mockSaveDeleted(...args),
}));

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
    mockSaveOverrides.mockReset().mockReturnValue(true);
    mockSaveDeleted.mockReset().mockReturnValue(true);
    mockFind.mockReset().mockReturnValue(null);
  });

  it("creates a local shell when the repo is missing", async () => {
    mockFetchBridge.mockResolvedValue({ files: [] });
    mockFind.mockReturnValueOnce(null).mockReturnValue({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });

    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(result.ok).toBe(true);
    expect(result.createdShell).toBe(true);
    expect(mockSaveStored).toHaveBeenCalled();
  });

  it("refreshes from bridge tip even when a stale local index exists", async () => {
    const shell = {
      entity: ENTITY,
      repo: "local-agent",
      slug: "local-agent",
      ownerPubkey: OWNER,
      hasUnpushedEdits: false,
      fileCount: 1,
    };
    mockFind.mockReturnValue(shell);
    mockLoadStored.mockReturnValue([shell]);
    mockLoadFiles.mockReturnValue([{ path: "old-only.md", type: "file" }]);
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
    expect(result.keptUnpushedLocal).toBe(false);
    expect(result.fileCount).toBe(2);
    expect(mockSaveFiles).toHaveBeenCalled();
    expect(mockSaveOverrides).toHaveBeenCalledWith(ENTITY, "local-agent", {});
    expect(mockSaveDeleted).toHaveBeenCalledWith(ENTITY, "local-agent", []);
  });

  it("keeps unpushed local edits and does not overwrite with the bridge", async () => {
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
    expect(result.keptUnpushedLocal).toBe(true);
    expect(result.hydratedFromBridge).toBe(false);
    expect(mockFetchBridge).not.toHaveBeenCalled();
  });

  it("keeps local when lastModifiedAt is newer than announce even if flag is false", async () => {
    mockFind.mockReturnValue({
      entity: ENTITY,
      repo: "local-agent",
      hasUnpushedEdits: false,
      lastNostrEventId: "evt1",
      lastNostrEventCreatedAt: 1_700_000_000,
      lastModifiedAt: 1_700_000_050 * 1000,
      fileCount: 1,
    });
    mockLoadFiles.mockReturnValue([{ path: "draft.txt", type: "file" }]);

    const result = await ensureLocalRepoForEdit({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(result.keptUnpushedLocal).toBe(true);
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
