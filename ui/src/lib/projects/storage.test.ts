import { beforeEach, describe, expect, it } from "vitest";

import {
  canonicalProjectsStorageKey,
  collectProjectStorageKeys,
  loadProjects,
  mergeGithubProjectsIntoLocal,
  persistProjects,
  projectsForTab,
} from "./storage";

const NPUB = "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
const REPO = "gittr";

const store = new Map<string, string>();

function installLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

beforeEach(() => {
  store.clear();
  installLocalStorage();
});

describe("project storage keys", () => {
  it("reads the legacy single-underscore key used before canonical __ keys", () => {
    const legacy = `gittr_projects_${NPUB}_${REPO}`;
    localStorage.setItem(
      legacy,
      JSON.stringify([
        {
          id: "project-1",
          name: "Local board",
          status: "active",
          items: [],
          createdAt: 1,
          view: "kanban",
          source: "local",
        },
      ])
    );
    expect(collectProjectStorageKeys(NPUB, REPO)).toContain(legacy);
    expect(loadProjects(NPUB, REPO).map((p) => p.id)).toEqual(["project-1"]);
  });

  it("migrates to the canonical key and keeps local boards across reload", () => {
    persistProjects(NPUB, REPO, [
      {
        id: "project-1",
        name: "Local board",
        status: "active",
        items: [],
        createdAt: 1,
        view: "kanban",
        source: "local",
      },
    ]);
    expect(store.has(canonicalProjectsStorageKey(NPUB, REPO))).toBe(true);
    expect(loadProjects(NPUB, REPO)[0]?.name).toBe("Local board");
  });
});

describe("projectsForTab", () => {
  const github = {
    id: "gh-project-abc",
    name: "GitHub",
    status: "active" as const,
    items: [],
    createdAt: 1,
    view: "kanban" as const,
    source: "github" as const,
  };
  const local = {
    id: "project-1",
    name: "Local",
    status: "active" as const,
    items: [],
    createdAt: 1,
    view: "kanban" as const,
    source: "local" as const,
  };

  it("shows only GitHub boards on forge-backed repos", () => {
    expect(
      projectsForTab([github, local], "forge-readonly").map((p) => p.id)
    ).toEqual(["gh-project-abc"]);
  });

  it("shows only local boards on nostr-only repos", () => {
    expect(
      projectsForTab([github, local], "nostr-local").map((p) => p.id)
    ).toEqual(["project-1"]);
  });

  it("keeps local boards when GitHub sync replaces GH boards", () => {
    const merged = mergeGithubProjectsIntoLocal(
      [github, local],
      [{ ...github, name: "GitHub refreshed" }]
    );
    expect(merged.find((p) => p.id === "project-1")).toBeTruthy();
    expect(merged.find((p) => p.id === "gh-project-abc")?.name).toBe(
      "GitHub refreshed"
    );
  });
});
