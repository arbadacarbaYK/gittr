import { describe, expect, it } from "vitest";

import {
  pagesDirectoryEventShape,
  parseRelayOkMessage,
} from "./publish-event-to-relay";

const id = "303852ae00b410e11e98a59c2b75f74b9a403728245f62af5501afc9d2df0ed2";

describe("parseRelayOkMessage", () => {
  it("accepts an OK for this event", () => {
    expect(parseRelayOkMessage(["OK", id, true, ""], id)).toEqual({
      done: true,
      ok: true,
    });
  });

  it("keeps the relay's reject reason", () => {
    expect(
      parseRelayOkMessage(["OK", id, false, "blocked: kind unallowed"], id)
    ).toEqual({
      done: true,
      ok: false,
      reason: "blocked: kind unallowed",
    });
  });

  it("ignores an OK for a different event", () => {
    expect(parseRelayOkMessage(["OK", "ab", true], id)).toEqual({
      done: false,
      ok: false,
    });
  });
});

describe("pagesDirectoryEventShape", () => {
  const event = {
    id,
    pubkey: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
    sig: "ab".repeat(64),
    kind: 35128,
    created_at: 1792344547,
    content: "",
    tags: [
      ["d", "gittr-docu"],
      ["path", "/index.html", "63c2ce896e5d1d2c"],
    ],
  };

  it("keeps a signed pages manifest", () => {
    const shaped = pagesDirectoryEventShape(event);
    expect(shaped.ok).toBe(true);
    if (shaped.ok) expect(shaped.event.tags[0]).toEqual(["d", "gittr-docu"]);
  });

  it("refuses anything that is not a pages manifest", () => {
    expect(pagesDirectoryEventShape({ ...event, kind: 1 }).ok).toBe(false);
    expect(pagesDirectoryEventShape({ ...event, tags: [["t", "x"]] }).ok).toBe(
      false
    );
  });
});
