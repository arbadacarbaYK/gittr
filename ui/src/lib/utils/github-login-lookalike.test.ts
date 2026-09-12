import { describe, expect, it } from "vitest";

import {
  githubLoginIsOwnerLookalike,
  isGithubNoreplyLookalikeOfAny,
} from "./github-login-lookalike";

describe("githubLoginIsOwnerLookalike", () => {
  it("drops the noreply cousin of the forge owner", () => {
    expect(githubLoginIsOwnerLookalike("ArBaDaCarBa", "arbadacarbaYK")).toBe(
      true
    );
  });

  it("keeps the real owner login", () => {
    expect(githubLoginIsOwnerLookalike("arbadacarbaYK", "arbadacarbaYK")).toBe(
      false
    );
  });

  it("does not treat short prefixes as lookalikes", () => {
    expect(githubLoginIsOwnerLookalike("dan", "danconwaydev")).toBe(false);
  });

  it("does not drop an unrelated longer login", () => {
    expect(githubLoginIsOwnerLookalike("octocat", "arbadacarbaYK")).toBe(false);
  });
});

describe("isGithubNoreplyLookalikeOfAny", () => {
  it("matches against another contributor login in the same list", () => {
    expect(
      isGithubNoreplyLookalikeOfAny("arbadacarba", ["octocat", "arbadacarbaYK"])
    ).toBe(true);
  });
});
