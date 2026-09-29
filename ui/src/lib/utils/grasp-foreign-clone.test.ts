import { describe, expect, it } from "vitest";

import { clonesAreForeignGraspOnly } from "./grasp-servers";

describe("clonesAreForeignGraspOnly", () => {
  it("is true for ngit and shakespeare clone URLs", () => {
    expect(
      clonesAreForeignGraspOnly([
        "https://relay.ngit.dev/npub14rg4vrt2v374q95ezeeydu3hkdhmzglcj950mggacap4x0lv0gyq04wun7/html1.git",
        "https://git.shakespeare.diy/npub14rg4vrt2v374q95ezeeydu3hkdhmzglcj950mggacap4x0lv0gyq04wun7/html1.git",
      ])
    ).toBe(true);
  });

  it("is false when git.gittr.space is one of the clones", () => {
    expect(
      clonesAreForeignGraspOnly([
        "https://git.gittr.space/npub1abc/html1.git",
        "https://relay.ngit.dev/npub1abc/html1.git",
      ])
    ).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(clonesAreForeignGraspOnly([])).toBe(false);
  });
});
