import { describe, expect, it } from "vitest";

import {
  jsonLdScriptHtml,
  softwareApplicationJsonLd,
  softwareSourceCodeJsonLd,
  websiteJsonLd,
} from "./json-ld";
import { SITE_DESCRIPTION_DEFAULT } from "./site-copy";
import { SITEMAP_HUBS, sitemapHubEntries } from "./sitemap-hubs";
import {
  isAppsCatalogPath,
  parseSoftwareAppPathId,
  softwareAppHref,
  softwareAppPath,
  uniqueSoftwareAppsForSitemap,
} from "./software-app-path";

describe("software-app-path", () => {
  it("builds and parses /apps/{id} paths", () => {
    expect(softwareAppPath("space.gittr.app")).toBe("/apps/space.gittr.app");
    expect(softwareAppHref("https://gittr.space", "space.gittr.app")).toBe(
      "https://gittr.space/apps/space.gittr.app"
    );
    expect(parseSoftwareAppPathId("/apps/space.gittr.app")).toBe(
      "space.gittr.app"
    );
    expect(parseSoftwareAppPathId("/apps", "q=zapstore")).toBe("zapstore");
    expect(parseSoftwareAppPathId("/apps/mine")).toBeNull();
    expect(parseSoftwareAppPathId("/apps")).toBeNull();
  });

  it("treats app detail URLs as catalog paths", () => {
    expect(isAppsCatalogPath("/apps")).toBe(true);
    expect(isAppsCatalogPath("/apps/space.gittr.app")).toBe(true);
    expect(isAppsCatalogPath("/explore")).toBe(false);
  });
});

describe("sitemap hubs", () => {
  it("includes apps, help, and the Nostr git explainer", () => {
    const paths = SITEMAP_HUBS.map((h) => h.path);
    expect(paths).toEqual(
      expect.arrayContaining(["/", "/explore", "/apps", "/help", "/nostr-git"])
    );
    const urls = sitemapHubEntries("https://gittr.space").map((e) => e.url);
    expect(urls).toContain("https://gittr.space");
    expect(urls).toContain("https://gittr.space/apps");
    expect(urls).toContain("https://gittr.space/nostr-git");
    expect(urls).toContain("https://gittr.space/help");
  });
});

describe("uniqueSoftwareAppsForSitemap", () => {
  it("dedupes package ids and skips mine", () => {
    const rows = uniqueSoftwareAppsForSitemap(
      [
        { appId: "mine", name: "Nope", createdAt: 9 },
        { appId: "space.gittr.app", name: "gittr", createdAt: 1 },
        { appId: "space.gittr.app", name: "gittr newer", createdAt: 5 },
        { appId: "other.app", name: "Other", createdAt: 3 },
      ],
      10
    );
    expect(rows.map((r) => r.appId)).toEqual(["space.gittr.app", "other.app"]);
    expect(rows[0]?.name).toBe("gittr newer");
  });
});

describe("json-ld", () => {
  it("describes the site and escapes script breakers", () => {
    const site = websiteJsonLd("https://gittr.space");
    expect(site["@type"]).toBe("WebSite");
    expect(JSON.stringify(site)).toContain("/explore?q={search_term_string}");
    const app = softwareApplicationJsonLd("https://gittr.space");
    expect(app.name).toBe("gittr");
    expect(String(app.description)).toContain("Nostr");
    const repo = softwareSourceCodeJsonLd({
      name: "alice/demo",
      description: "demo repo",
      url: "https://gittr.space/npub1x/demo",
    });
    expect(repo["@type"]).toBe("SoftwareSourceCode");
    expect(jsonLdScriptHtml({ x: "</script><p>" })).toContain(
      "\\u003c/script>"
    );
  });

  it("keeps the default description oriented at Nostr git hosting", () => {
    expect(SITE_DESCRIPTION_DEFAULT.toLowerCase()).toContain("nostr");
    expect(SITE_DESCRIPTION_DEFAULT.toLowerCase()).toMatch(/git/);
  });
});
