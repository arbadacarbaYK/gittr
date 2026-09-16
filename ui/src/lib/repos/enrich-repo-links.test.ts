import { describe, expect, it } from "vitest";

import {
  enrichRepoLinks,
  mergeAnnouncementLinksWithLocal,
  stripAppListingFromRepoFields,
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

  it("drops a leftover App (GITTR) tag from a 30617 announcement", () => {
    const merged = mergeAnnouncementLinksWithLocal(
      [
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.app",
          label: "App (space.gittr.app)",
        },
      ],
      [
        {
          type: "other",
          url: "https://gittr.space/apps?q=GITTR",
          label: "App (GITTR)",
        },
      ]
    );
    expect(merged.map((l) => l.label)).toEqual(["App (space.gittr.app)"]);
  });

  it("collapses the same App id from local vs catalog origins", () => {
    const merged = mergeAnnouncementLinksWithLocal(
      [
        {
          type: "other",
          url: "http://127.0.0.1:3000/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
      ],
      [
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
      ]
    );
    const appRows = merged.filter((l) =>
      String(l.url || "").includes("/apps?q=")
    );
    expect(appRows).toHaveLength(1);
    expect(appRows[0]?.label).toBe("App (space.gittr.buhogo)");
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

  it("drops leftover App (GITTR) and keeps the live package id", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "other",
          url: "https://gittr.space/apps?q=GITTR",
          label: "App (GITTR)",
        },
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.app",
          label: "App (space.gittr.app)",
        },
      ],
      announcedAppId: "space.gittr.app",
      siteOrigin: "https://gittr.space",
    });
    const labels = links.map((l) => l.label);
    expect(labels).toContain("App (space.gittr.app)");
    expect(labels.some((l) => l?.includes("GITTR"))).toBe(false);
  });

  it("never re-adds GITTR from announcedAppId", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "other",
          url: "https://gittr.space/apps?q=GITTR",
          label: "App (GITTR)",
        },
      ],
      announcedAppId: "GITTR",
      siteOrigin: "https://gittr.space",
    });
    expect(links.map((l) => l.label)).not.toContain("App (GITTR)");
  });

  it("keeps a single App row when local and catalog origins differ", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "other",
          url: "http://127.0.0.1:3000/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
      ],
      announcedAppId: "space.gittr.buhogo",
      siteOrigin: "https://gittr.space",
    });
    const appRows = links.filter((l) => /^App \(/i.test(String(l.label || "")));
    expect(appRows).toHaveLength(1);
    expect(appRows[0]?.url).toBe(
      "https://gittr.space/apps?q=space.gittr.buhogo"
    );
  });

  it("keeps an existing App link when announcedAppId is cleared", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
      ],
      announcedAppId: null,
      siteOrigin: "https://gittr.space",
    });
    const appRows = links.filter((l) => /^App \(/i.test(String(l.label || "")));
    expect(appRows).toHaveLength(1);
    expect(appRows[0]?.label).toBe("App (space.gittr.buhogo)");
  });

  it("labels the App row with the catalog name, not the package id", () => {
    const links = enrichRepoLinks({
      existing: [
        {
          type: "other",
          url: "https://gittr.space/apps?q=space.gittr.buhogo",
          label: "App (space.gittr.buhogo)",
        },
      ],
      announcedAppId: "space.gittr.buhogo",
      announcedAppName: "buho-go",
      siteOrigin: "https://gittr.space",
    });
    const appRows = links.filter((l) =>
      String(l.url || "").includes("/apps?q=space.gittr.buhogo")
    );
    expect(appRows).toHaveLength(1);
    expect(appRows[0]?.label).toBe("buho-go");
  });
});

describe("stripAppListingFromRepoFields", () => {
  it("removes App (GITTR) without clearing space.gittr.app", () => {
    const out = stripAppListingFromRepoFields(
      {
        announcedAppId: "space.gittr.app",
        links: [
          {
            type: "other" as const,
            url: "https://gittr.space/apps?q=GITTR",
            label: "App (GITTR)",
          },
          {
            type: "other" as const,
            url: "https://gittr.space/apps?q=space.gittr.app",
            label: "App (space.gittr.app)",
          },
        ],
      },
      "GITTR"
    );
    expect(out.changed).toBe(true);
    expect(out.announcedAppId).toBe("space.gittr.app");
    expect(out.links?.map((l) => l.label)).toEqual(["App (space.gittr.app)"]);
  });

  it("clears announcedAppId but keeps the App (id) link", () => {
    const out = stripAppListingFromRepoFields(
      {
        announcedAppId: "space.gittr.buhogo",
        links: [
          {
            type: "other" as const,
            url: "https://gittr.space/apps?q=space.gittr.buhogo",
            label: "App (space.gittr.buhogo)",
          },
        ],
      },
      "space.gittr.buhogo"
    );
    expect(out.changed).toBe(true);
    expect(out.announcedAppId).toBeUndefined();
    expect(out.links?.map((l) => l.label)).toEqual([
      "App (space.gittr.buhogo)",
    ]);
  });
});
