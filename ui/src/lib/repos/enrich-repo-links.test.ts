import { describe, expect, it } from "vitest";

import {
  enrichRepoLinks,
  mergeAnnouncementLinksWithLocal,
} from "./enrich-repo-links";

describe("mergeAnnouncementLinksWithLocal", () => {
  it("keeps local Settings links when Nostr only has forge web", () => {
    const merged = mergeAnnouncementLinksWithLocal(
      [
        {
          type: "docs",
          url: "https://docs.example.com",
          label: "API docs",
        },
        {
          type: "docs",
          url: "https://gitworkshop.dev/npub1x/relay.ngit.dev/repo",
        },
      ],
      [] // forge web filtered out by parser
    );
    expect(merged).toEqual([
      {
        type: "docs",
        url: "https://docs.example.com",
        label: "API docs",
      },
    ]);
  });

  it("merges Website homepage with announcement docs", () => {
    const merged = mergeAnnouncementLinksWithLocal(
      [{ type: "docs", url: "https://project.example", label: "Website" }],
      [{ type: "docs", url: "https://docs.example.com/guide", label: "Guide" }]
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((l) => l.label).sort()).toEqual(["Guide", "Website"]);
  });
});

describe("enrichRepoLinks", () => {
  it("strips stale forge docs while adding homepage Website", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "docs",
          url: "https://gitworkshop.dev/npub1a/relay.ngit.dev/r",
        },
        {
          type: "docs",
          url: "https://docs.example.com",
          label: "Custom",
        },
      ],
      homepage: "https://pages.example.com",
    });
    expect(links.map((l) => l.url).sort()).toEqual([
      "https://docs.example.com",
      "https://pages.example.com",
    ]);
    expect(links.find((l) => l.url.includes("pages"))?.label).toBe("Website");
  });

  it("labels a confirmed Nostr Page with the public site name", () => {
    const links = enrichRepoLinks({
      existing: [],
      nostrPagesUrl:
        "https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-docu.pages.gittr.space/",
      nostrPagesLabel: "Nostr Pages · gittr-docu",
    });
    expect(links[0]?.label).toBe("Nostr Pages · gittr-docu");
  });
});
