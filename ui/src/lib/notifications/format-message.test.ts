import { describe, expect, it } from "vitest";

import {
  formatNotificationMessage,
  notificationIssueOrPrPhrase,
} from "./index";

const HEX = "127dbf67c5af53b1ed5b5f94f830f96affab7961f92437bc95fa02f50e8553ca";

describe("notificationIssueOrPrPhrase", () => {
  it("prefers the title over a Nostr event id", () => {
    expect(
      notificationIssueOrPrPhrase({
        kind: "issue",
        id: HEX,
        title: "Don’t copy LAN relays",
      })
    ).toBe('"Don’t copy LAN relays"');
  });

  it("does not put a 64-char hex after #", () => {
    expect(notificationIssueOrPrPhrase({ kind: "issue", id: HEX })).toBe(
      "issue 127dbf67"
    );
  });

  it("keeps forge-style numbers", () => {
    expect(notificationIssueOrPrPhrase({ kind: "issue", id: "12" })).toBe(
      "issue #12"
    );
  });
});

describe("formatNotificationMessage", () => {
  it("keeps clickable URLs on the event id", () => {
    const n = formatNotificationMessage("issue_commented", {
      repoEntity: "npub1abc",
      repoName: "soapbox.pub",
      issueId: HEX,
      issueTitle: "Don’t copy LAN relays",
      url: `https://gittr.space/npub1abc/soapbox.pub/issues/${HEX}`,
    });
    expect(n.title).toContain("Don’t copy LAN relays");
    expect(n.title).not.toContain(`#${HEX}`);
    expect(n.url).toContain(HEX);
  });

  it("uses the title in bounty and mention copy", () => {
    const funded = formatNotificationMessage("bounty_funded", {
      issueId: HEX,
      issueTitle: "Pay the plumber",
    });
    expect(funded.title).toBe('Bounty funded on "Pay the plumber"');
    const mention = formatNotificationMessage("mention", {
      repoEntity: "npub1abc",
      repoName: "soapbox.pub",
      issueId: HEX,
      issueTitle: "Pay the plumber",
      authorName: "Ada",
    });
    expect(mention.message).toContain('"Pay the plumber"');
    expect(mention.message).not.toContain(`#${HEX}`);
  });
});
