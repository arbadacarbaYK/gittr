import type { Event } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  computeRepoZapBadgeTotal,
  embeddedZapRequestId,
  zapReceipt9735ToRecord,
  zapRecordHref,
  zapRecordMatchesRepo,
} from "./zap-tracker";

const owner = "a".repeat(64);
const sender = "b".repeat(64);
const receiptId = "d".repeat(64);
const requestId = "e".repeat(64);

function receipt(
  tags: string[][],
  description: Record<string, unknown>
): Event {
  return {
    kind: 9735,
    id: receiptId,
    pubkey: "f".repeat(64),
    created_at: 1_700_000_000,
    content: "",
    sig: "ab".repeat(64),
    tags: [
      ...tags,
      ["description", JSON.stringify(description)],
      ["bolt11", "lnbc21u1example"],
    ],
  };
}

describe("zap receipts from other clients", () => {
  it("counts a repo zap that only has an announcement a-tag", () => {
    const event = receipt(
      [
        ["p", owner],
        ["P", sender],
        ["a", `30617:${owner}:gittr`],
      ],
      {
        id: requestId,
        pubkey: sender,
        content: "nice work",
        tags: [
          ["p", owner],
          ["a", `30617:${owner}:gittr`],
          ["amount", "21000"],
        ],
      }
    );
    const row = zapReceipt9735ToRecord(event);
    expect(row?.type).toBe("repo");
    expect(row?.comment).toBe("nice work");
    expect(row?.amount).toBe(21);
    expect(zapRecordMatchesRepo(row!, owner, "alice", "gittr")).toBe(true);
    expect(zapRecordMatchesRepo(row!, owner, "alice", "other")).toBe(false);
    expect(embeddedZapRequestId(event)).toBe(requestId);
    expect(zapRecordHref(row!)).toMatch(/^\/npub1.+\/gittr$/);

    const total = computeRepoZapBadgeTotal(owner, "alice", "gittr", [event]);
    expect(total.networkSats).toBe(21);
    expect(total.zappers).toEqual([{ pubkey: sender, totalSats: 21 }]);
  });

  it("still counts an older gittr tip that only named the repo in the note", () => {
    const event = receipt(
      [
        ["p", owner],
        ["P", sender],
      ],
      {
        pubkey: sender,
        content: "Zap for alice/gittr",
        tags: [
          ["p", owner],
          ["amount", "10000"],
        ],
      }
    );
    const row = zapReceipt9735ToRecord(event);
    expect(row?.contextId).toBe("alice/gittr");
    expect(zapRecordMatchesRepo(row!, owner, "alice", "gittr")).toBe(true);
    expect(zapRecordHref(row!)).toBe("/alice/gittr");
  });
});
