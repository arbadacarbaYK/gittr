import { describe, expect, it } from "vitest";

import { parseRepoLinksFromNip34Tags } from "./parse-nip34-repo-links";

describe("parseRepoLinksFromNip34Tags", () => {
  it("labels git.iris.to web tags as Iris Git", () => {
    const links = parseRepoLinksFromNip34Tags([
      [
        "web",
        "https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/fips",
      ],
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.label).toBe("Iris Git");
    expect(links[0]?.type).toBe("docs");
    expect(links[0]?.url).toContain("git.iris.to");
  });

  it("does not invent Iris labels for other hosts", () => {
    const links = parseRepoLinksFromNip34Tags([
      ["web", "https://example.com/docs"],
    ]);
    expect(links[0]?.label).toBeUndefined();
  });
});
