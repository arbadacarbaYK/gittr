import { describe, expect, it } from "vitest";

import {
  applyKind0NameFields,
  pickProfileDisplayName,
} from "./kind0-profile-fields";

describe("pickProfileDisplayName", () => {
  it("prefers display_name over name", () => {
    expect(pickProfileDisplayName({ display_name: "Ada", name: "ada" })).toBe(
      "Ada"
    );
  });

  it("uses camelCase displayName when display_name is missing", () => {
    expect(pickProfileDisplayName({ displayName: "BBakker", name: "" })).toBe(
      "BBakker"
    );
  });

  it("uses name when both display fields are empty", () => {
    expect(pickProfileDisplayName({ name: "BBakker" })).toBe("BBakker");
  });

  it("treats empty display_name as missing so name still wins", () => {
    expect(
      pickProfileDisplayName({ display_name: "  ", name: "BBakker" })
    ).toBe("BBakker");
  });

  it("rejects npub-shaped and hex stubs", () => {
    expect(pickProfileDisplayName({ name: "npub1abc" })).toBeNull();
    expect(pickProfileDisplayName({ name: "a".repeat(64) })).toBeNull();
    expect(pickProfileDisplayName({ name: "Anonymous Nostrich" })).toBeNull();
    expect(pickProfileDisplayName({})).toBeNull();
  });
});

describe("applyKind0NameFields", () => {
  it("copies displayName onto display_name for downstream snake_case readers", () => {
    const next = applyKind0NameFields({
      displayName: "BBakker",
      name: "BBakker",
      about: "HI",
    });
    expect(next.display_name).toBe("BBakker");
    expect(next.name).toBe("BBakker");
  });
});
