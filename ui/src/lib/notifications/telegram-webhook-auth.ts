import { timingSafeEqual } from "node:crypto";

/**
 * Telegram sends X-Telegram-Bot-Api-Secret-Token when the webhook was
 * registered with secret_token. Until TELEGRAM_WEBHOOK_SECRET is set, the
 * check stays open so /start keeps working.
 */
export function telegramWebhookAuthorized(
  headerValue: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret) return true;
  const enc = new TextEncoder();
  const got = enc.encode(headerValue ?? "");
  const expected = enc.encode(secret);
  if (got.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(got, expected);
}
