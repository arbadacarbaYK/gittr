import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConsentStoreUnreadableError,
  loadNotificationConsentStore,
  saveNotificationConsentStore,
  upsertNotificationConsent,
} from "./notification-consent-store";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmpConsentFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "gittr-consent-"));
  dirs.push(dir);
  return join(dir, "notifications-consent.json");
}

describe("notification-consent-store wipe guards", () => {
  it("upsert keeps existing pubkeys when adding one", () => {
    const file = tmpConsentFile();
    saveNotificationConsentStore(
      {
        byPubkey: {
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
            nostr: true,
            telegram: false,
            events: { security_cve: true },
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      file
    );
    upsertNotificationConsent(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      {
        nostr: true,
        telegram: true,
        telegramUserId: "12345",
        events: { security_cve: false },
      },
      file
    );
    const store = loadNotificationConsentStore(file);
    expect(Object.keys(store.byPubkey)).toHaveLength(2);
  });

  it("refuses empty overwrite of non-empty store", () => {
    const file = tmpConsentFile();
    saveNotificationConsentStore(
      {
        byPubkey: {
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
            nostr: true,
            telegram: false,
            events: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      file
    );
    expect(() => saveNotificationConsentStore({ byPubkey: {} }, file)).toThrow(
      /refusing to overwrite non-empty/
    );
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(raw.byPubkey)).toHaveLength(1);
  });

  it("allowEmptyOverwrite permits intentional clear", () => {
    const file = tmpConsentFile();
    saveNotificationConsentStore(
      {
        byPubkey: {
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
            nostr: true,
            telegram: false,
            events: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      file
    );
    saveNotificationConsentStore({ byPubkey: {} }, file, {
      allowEmptyOverwrite: true,
    });
    expect(loadNotificationConsentStore(file).byPubkey).toEqual({});
  });

  it("corrupt file throws instead of returning empty", () => {
    const file = tmpConsentFile();
    writeFileSync(file, "{not-json");
    expect(() => loadNotificationConsentStore(file)).toThrow(
      ConsentStoreUnreadableError
    );
  });
});
