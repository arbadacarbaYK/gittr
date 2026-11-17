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

  it("shows imported and local boards together", () => {
    expect(
      projectsForTab([github, local], "forge-readonly").map((p) => p.id)
    ).toEqual(["gh-project-abc", "project-1"]);
    expect(
      projectsForTab([github, local], "nostr-local").map((p) => p.id)
    ).toEqual(["gh-project-abc", "project-1"]);
  });

  it("hides a board the user removed", () => {
    expect(
      projectsForTab([{ ...local, hidden: true }, github], "nostr-local").map(
        (p) => p.id
      )
    ).toEqual(["gh-project-abc"]);
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

  it("does not reset a published GitHub board when GitHub is opened again", () => {
    const published = {
      ...github,
      nostrD: "gittr--gh-project-abc",
      items: [
        {
          id: "gh-item-1",
          title: "Stay put",
          status: "in_progress",
          githubItemId: "ITEM1",
        },
      ],
    };
    const merged = mergeGithubProjectsIntoLocal(
      [published],
      [
        {
          ...github,
          items: [
            {
              id: "gh-item-1",
              title: "Stay put",
              status: "todo",
              githubItemId: "ITEM1",
            },
            {
              id: "gh-item-2",
              title: "New on GitHub",
              status: "todo",
              githubItemId: "ITEM2",
            },
          ],
        },
      ]
    );
    const board = merged.find((p) => p.id === "gh-project-abc");
    const items = board?.items as Array<{
      githubItemId?: string;
      status?: string;
    }>;
    expect(items.find((item) => item.githubItemId === "ITEM1")?.status).toBe(
      "in_progress"
    );
    expect(items.some((item) => item.githubItemId === "ITEM2")).toBe(true);
  });
});
