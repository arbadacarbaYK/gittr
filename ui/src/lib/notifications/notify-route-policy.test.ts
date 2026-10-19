import { afterEach, describe, expect, it } from "vitest";

import { notificationTestEndpointEnabled } from "./notify-route-policy";
import { isTelegramChatId } from "./telegram-outbound";

describe("notificationTestEndpointEnabled", () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.NOTIFICATIONS_TEST_ENABLED;

  afterEach(() => {
    process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.NOTIFICATIONS_TEST_ENABLED;
    else process.env.NOTIFICATIONS_TEST_ENABLED = prevFlag;
  });

  it("stays closed in production even if the flag is set", () => {
    process.env.NODE_ENV = "production";
    process.env.NOTIFICATIONS_TEST_ENABLED = "1";
    expect(notificationTestEndpointEnabled()).toBe(false);
  });

  it("stays closed in development until the flag is set", () => {
    process.env.NODE_ENV = "development";
    delete process.env.NOTIFICATIONS_TEST_ENABLED;
    expect(notificationTestEndpointEnabled()).toBe(false);
  });

  it("opens only outside production when the flag is 1", () => {
    process.env.NODE_ENV = "development";
    process.env.NOTIFICATIONS_TEST_ENABLED = "1";
    expect(notificationTestEndpointEnabled()).toBe(true);
  });
});

describe("isTelegramChatId", () => {
  it("accepts numeric user and channel ids", () => {
    expect(isTelegramChatId("123456789")).toBe(true);
    expect(isTelegramChatId("-100123")).toBe(true);
  });

  it("rejects names and injection", () => {
    expect(isTelegramChatId("@gittrspace")).toBe(false);
    expect(isTelegramChatId("1\n2")).toBe(false);
    expect(isTelegramChatId("")).toBe(false);
  });
});
