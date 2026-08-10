import { describe, expect, it } from "vitest";

import { deepMergePrefs, DEFAULT_PREFS } from "./prefs";
import {
  KIND_NOTIFICATION_PREFS,
  LEGACY_CVE_OPT_IN_D_TAG,
  NOTIFICATION_PREFS_D_TAG,
  buildNotificationPrefsUnsignedEvent,
  isSecurityCveOptedIn,
  parseNotificationPrefsContent,
  pickLatestNotificationPrefsEvent,
} from "./notification-prefs-event";
import { consentAllowsEvent } from "./notification-consent-store";

describe("notification prefs event", () => {
  it("builds full prefs under d=gittr/notifications", () => {
    const prefs = deepMergePrefs({
      channels: { nostr: { enabled: true }, telegram: { enabled: true } },
      events: { security_cve: true, pr_opened: false },
    });
    const ev = buildNotificationPrefsUnsignedEvent("ab".repeat(32), prefs);
    expect(ev.kind).toBe(KIND_NOTIFICATION_PREFS);
    expect(ev.tags).toEqual([["d", NOTIFICATION_PREFS_D_TAG]]);
    const body = JSON.parse(ev.content);
    expect(body.channels).toEqual({ nostr: true, telegram: true });
    expect(body.events.security_cve).toBe(true);
    expect(body.events.pr_opened).toBe(false);
  });

  it("parses legacy CVE-only content into security_cve", () => {
    const prefs = parseNotificationPrefsContent(
      JSON.stringify({
        enabled: true,
        channels: { nostr: true, telegram: false },
      })
    );
    expect(prefs?.events.security_cve).toBe(true);
    expect(prefs?.channels.nostr.enabled).toBe(true);
  });

  it("prefers canonical d over legacy when picking latest", () => {
    const latest = pickLatestNotificationPrefsEvent([
      {
        kind: 30078,
        created_at: 100,
        tags: [["d", LEGACY_CVE_OPT_IN_D_TAG]],
        content: JSON.stringify({ enabled: true }),
      },
      {
        kind: 30078,
        created_at: 100,
        tags: [["d", NOTIFICATION_PREFS_D_TAG]],
        content: JSON.stringify({
          v: 1,
          channels: { nostr: true, telegram: false },
          events: { security_cve: false },
        }),
      },
    ]);
    expect(isSecurityCveOptedIn(latest)).toBe(false);
  });
});

describe("consentAllowsEvent", () => {
  it("uses defaults when no consent record", () => {
    expect(consentAllowsEvent(null, "pr_opened")).toBe(
      DEFAULT_PREFS.events.pr_opened
    );
    expect(consentAllowsEvent(null, "security_cve")).toBe(false);
  });

  it("honors stored event toggles", () => {
    expect(
      consentAllowsEvent(
        {
          nostr: true,
          telegram: false,
          events: { pr_opened: false, security_cve: true },
          updatedAt: "",
        },
        "pr_opened"
      )
    ).toBe(false);
    expect(
      consentAllowsEvent(
        {
          nostr: true,
          telegram: false,
          events: { security_cve: true },
          updatedAt: "",
        },
        "security_cve"
      )
    ).toBe(true);
  });
});
