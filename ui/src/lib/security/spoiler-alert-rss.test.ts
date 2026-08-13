import { describe, expect, it } from "vitest";

import {
  eligibleSpoilerAlerts,
  formatSpoilerNotificationDm,
  matchSpoilersToPackages,
  packageMatchesSpoilerGithubRepo,
  parseSpoilerAlertRssXml,
  parseSpoilerGithubRepoFromTitle,
  spoilerDedupKey,
} from "./spoiler-alert-rss";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Vulnerability Spoiler Alert</title>
    <item>
      <title>[HIGH] Privilege Escalation in grafana/grafana</title>
      <link>https://github.com/spaceraccoon/vulnerability-spoiler-alert/issues/418</link>
      <guid isPermaLink="true">https://github.com/spaceraccoon/vulnerability-spoiler-alert/issues/418</guid>
      <description>Hardcoded Admin role.&apos;s oops</description>
      <category>high</category>
      <category>unverified</category>
    </item>
    <item>
      <title>[MEDIUM] Something in grafana/grafana</title>
      <link>https://example.com/m</link>
      <guid>guid-medium</guid>
      <description>skip me</description>
      <category>medium</category>
      <category>verified</category>
    </item>
    <item>
      <title>[CRITICAL] RCE in keycloak/keycloak</title>
      <link>https://example.com/c</link>
      <guid>guid-crit</guid>
      <description>bad</description>
      <category>critical</category>
      <category>verified</category>
    </item>
  </channel>
</rss>`;

describe("parseSpoilerAlertRssXml", () => {
  it("parses severity, verified, github repo, entities", () => {
    const items = parseSpoilerAlertRssXml(SAMPLE_XML);
    expect(items).toHaveLength(3);
    expect(items[0]?.severity).toBe("HIGH");
    expect(items[0]?.verified).toBe(false);
    expect(items[0]?.githubRepo).toBe("grafana/grafana");
    expect(items[0]?.summary).toContain("Hardcoded Admin role.'s oops");
    expect(items[2]?.severity).toBe("CRITICAL");
    expect(items[2]?.verified).toBe(true);
  });
});

describe("parseSpoilerGithubRepoFromTitle", () => {
  it("reads trailing in owner/repo", () => {
    expect(
      parseSpoilerGithubRepoFromTitle(
        "[HIGH] Privilege Escalation in grafana/grafana"
      )
    ).toBe("grafana/grafana");
  });
});

describe("eligibleSpoilerAlerts", () => {
  it("keeps only HIGH/CRITICAL", () => {
    const items = parseSpoilerAlertRssXml(SAMPLE_XML);
    const el = eligibleSpoilerAlerts(items);
    expect(el.map((i) => i.severity)).toEqual(["HIGH", "CRITICAL"]);
  });
});

describe("packageMatchesSpoilerGithubRepo", () => {
  it("matches scoped npm, exact repo name, and go paths", () => {
    expect(
      packageMatchesSpoilerGithubRepo("@grafana/data", "grafana/grafana")
    ).toBe(true);
    expect(packageMatchesSpoilerGithubRepo("grafana", "grafana/grafana")).toBe(
      true
    );
    expect(
      packageMatchesSpoilerGithubRepo(
        "github.com/grafana/grafana/pkg/foo",
        "grafana/grafana"
      )
    ).toBe(true);
    expect(packageMatchesSpoilerGithubRepo("lodash", "grafana/grafana")).toBe(
      false
    );
  });
});

describe("matchSpoilersToPackages", () => {
  it("matches direct deps only by default", () => {
    const items = parseSpoilerAlertRssXml(SAMPLE_XML);
    const matches = matchSpoilersToPackages(items, [
      { name: "@grafana/data", direct: true },
      { name: "grafana", direct: false },
      { name: "keycloak", direct: true },
    ]);
    expect(matches.map((m) => m.packageName).sort()).toEqual([
      "@grafana/data",
      "keycloak",
    ]);
  });
});

describe("spoilerDedupKey / formatSpoilerNotificationDm", () => {
  it("builds stable keys and repo-first DM copy", () => {
    expect(spoilerDedupKey("ABC", "tides", "guid-1", "@grafana/data")).toBe(
      "abc|tides|spoiler:guid-1|@grafana/data"
    );
    const items = parseSpoilerAlertRssXml(SAMPLE_XML);
    const matches = matchSpoilersToPackages(items, [
      { name: "@grafana/data", direct: true },
    ]);
    const dm = formatSpoilerNotificationDm({
      repoName: "tides",
      matches,
    });
    expect(dm.title).toMatch(/^Early security warning: tides/);
    expect(dm.message).toContain("not an OSV/CVE confirmation");
    expect(dm.message).toContain("Not shown on the Dependencies tab");
  });
});
