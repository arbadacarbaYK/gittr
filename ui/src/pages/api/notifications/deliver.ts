import { rateLimiters } from "@/app/api/middleware/rate-limit";
import {
  handlePaymentOptionsRequest,
  setPaymentCorsHeaders,
} from "@/lib/api/cors";
import {
  consentAllowsEvent,
  getNotificationConsent,
} from "@/lib/notifications/notification-consent-store";
import { sendPlatformNostrNotification } from "@/lib/notifications/platform-nostr-dm";
import { DEFAULT_PREFS, type EventKey } from "@/lib/notifications/prefs";
import { sendTelegramDmToChat } from "@/lib/notifications/telegram-outbound";

import type { NextApiRequest, NextApiResponse } from "next";

const EVENT_KEYS = new Set<string>(Object.keys(DEFAULT_PREFS.events));

/**
 * Deliver a notification to a recipient using THEIR registered consent
 * (not the actor's browser localStorage).
 *
 * POST { recipientPubkey, eventType, title, message, url? }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handlePaymentOptionsRequest(res, req);
    return;
  }
  setPaymentCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const rateLimitResult = await rateLimiters.notifications(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  const { recipientPubkey, eventType, title, message, url } = req.body || {};

  if (!recipientPubkey || !eventType || !title || !message) {
    return res.status(400).json({
      error: "missing_params",
      message: "Missing recipientPubkey, eventType, title, or message",
    });
  }

  if (!EVENT_KEYS.has(String(eventType))) {
    return res.status(400).json({ error: "invalid_event_type" });
  }

  const titleText = String(title);
  const messageText = String(message);
  const urlText = url ? String(url) : undefined;
  if (
    titleText.length > 300 ||
    messageText.length > 3500 ||
    (urlText && urlText.length > 2000)
  ) {
    return res.status(400).json({ error: "payload_too_large" });
  }

  const key = String(eventType) as EventKey;
  const consent = getNotificationConsent(String(recipientPubkey));

  if (!consentAllowsEvent(consent, key)) {
    return res.status(200).json({
      status: "skipped",
      reason: "event_disabled",
      eventType: key,
    });
  }

  const wantNostr = consent
    ? consent.nostr
    : DEFAULT_PREFS.channels.nostr.enabled;
  const wantTelegram = consent
    ? consent.telegram
    : DEFAULT_PREFS.channels.telegram.enabled;

  if (!wantNostr && !wantTelegram) {
    return res.status(200).json({
      status: "skipped",
      reason: "all_channels_off",
    });
  }

  const results: Record<string, unknown> = {};

  if (wantNostr) {
    try {
      const sent = await sendPlatformNostrNotification({
        recipientPubkey: String(recipientPubkey),
        title: titleText,
        message: messageText,
        url: urlText,
      });
      if (sent.ok) {
        results.nostr = {
          status: 200,
          body: {
            status: sent.mode === "sent" ? "ok" : "use_user_key",
          },
        };
      } else {
        results.nostr = {
          status: sent.error === "invalid_recipient" ? 400 : 500,
          body: { error: sent.error },
        };
      }
    } catch (e: any) {
      results.nostr = { error: e?.message || String(e) };
    }
  }

  if (wantTelegram) {
    const userId = consent?.telegramUserId;
    if (!userId) {
      results.telegram = { skipped: "no_telegram_userid" };
    } else {
      try {
        const sent = await sendTelegramDmToChat({
          chatId: userId,
          title: titleText,
          message: messageText,
          url: urlText,
        });
        results.telegram = sent.ok
          ? {
              status: 200,
              body: {
                status: "ok",
                message: "Telegram DM sent",
                messageId: sent.messageId,
              },
            }
          : {
              status: 500,
              body: { error: sent.error },
            };
      } catch (e: any) {
        results.telegram = { error: e?.message || String(e) };
      }
    }
  }

  const nostrFailed =
    wantNostr &&
    !(
      results.nostr &&
      typeof results.nostr === "object" &&
      (results.nostr as { status?: number }).status === 200
    );
  const telegramFailed =
    wantTelegram &&
    !(
      results.telegram &&
      typeof results.telegram === "object" &&
      ((results.telegram as { skipped?: string }).skipped ||
        (results.telegram as { status?: number }).status === 200)
    );

  let status: "ok" | "partial" | "failed" = "ok";
  if (nostrFailed || telegramFailed) {
    status =
      wantNostr && wantTelegram && !(nostrFailed && telegramFailed)
        ? "partial"
        : "failed";
  }

  return res.status(200).json({
    status,
    eventType: key,
    channels: { nostr: wantNostr, telegram: wantTelegram },
    results,
  });
}
