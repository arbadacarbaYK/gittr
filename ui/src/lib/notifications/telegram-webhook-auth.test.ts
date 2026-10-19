import { describe, expect, it } from "vitest";

import { telegramWebhookAuthorized } from "./telegram-webhook-auth";

describe("telegramWebhookAuthorized", () => {
  it("allows requests when no secret is configured", () => {
    expect(telegramWebhookAuthorized(undefined, undefined)).toBe(true);
    expect(telegramWebhookAuthorized(undefined, "")).toBe(true);
  });

  it("requires an exact header when a secret is set", () => {
    expect(telegramWebhookAuthorized("s3cret", "s3cret")).toBe(true);
    expect(telegramWebhookAuthorized("nope", "s3cret")).toBe(false);
    expect(telegramWebhookAuthorized(undefined, "s3cret")).toBe(false);
    expect(telegramWebhookAuthorized("s3cret-extra", "s3cret")).toBe(false);
  });
});
