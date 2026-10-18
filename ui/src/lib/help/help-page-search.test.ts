import { describe, expect, it } from "vitest";

import {
  type HelpBlock,
  countHelpSearchHits,
  countVisibleHelpMatches,
  planHelpSearch,
} from "./help-page-search";

const blocks: HelpBlock[] = [
  { id: "start", parentId: null, ownText: "Getting Started" },
  {
    id: "login",
    parentId: "start",
    ownText: "Login with NIP-07 Flamingo nos2x",
  },
  { id: "login-step", parentId: "login", ownText: "Install the extension" },
  { id: "keys", parentId: "start", ownText: "SSH Keys clone git.gittr.space" },
  { id: "push", parentId: null, ownText: "Push to Nostr" },
  {
    id: "push-body",
    parentId: "push",
    ownText: "Publish the repository state",
  },
  { id: "manifest", parentId: "push", ownText: "Push Manifest for Pages" },
];

describe("planHelpSearch", () => {
  it("shows every topic when the box is empty", () => {
    const views = planHelpSearch(blocks, "   ");
    for (const view of views.values()) {
      expect(view.visible).toBe(true);
      expect(view.open).toBe(false);
      expect(view.hit).toBe(false);
    }
  });

  it("opens the topic that contains the word and hides the others", () => {
    const views = planHelpSearch(blocks, "flamingo");
    expect(views.get("start")).toMatchObject({
      visible: true,
      open: true,
      hit: false,
    });
    expect(views.get("login")).toMatchObject({
      visible: true,
      open: true,
      hit: true,
    });
    expect(views.get("login-step")).toMatchObject({
      visible: true,
      open: false,
    });
    expect(views.get("keys")?.visible).toBe(false);
    expect(views.get("push")?.visible).toBe(false);
  });

  it("opens a matching title and keeps its writing folded", () => {
    const views = planHelpSearch(blocks, "getting started");
    expect(views.get("start")).toMatchObject({
      visible: true,
      open: true,
      hit: true,
    });
    expect(views.get("login")).toMatchObject({ visible: true, open: false });
    expect(views.get("keys")).toMatchObject({ visible: true, open: false });
    expect(views.get("push")?.visible).toBe(false);
  });

  it("finds a phrase split across two parts of the same topic", () => {
    const views = planHelpSearch(blocks, "repository manifest");
    expect(views.get("push")).toMatchObject({ visible: true, open: true });
    expect(views.get("push-body")?.visible).toBe(true);
    expect(views.get("manifest")).toMatchObject({ visible: true, open: true });
    expect(views.get("start")?.visible).toBe(false);
    expect(countVisibleHelpMatches(blocks, views)).toBe(2);
  });

  it("ignores letter case", () => {
    const views = planHelpSearch(blocks, "SSH");
    expect(views.get("keys")?.hit).toBe(true);
    expect(countHelpSearchHits(views)).toBe(1);
  });
});
