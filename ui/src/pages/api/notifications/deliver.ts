import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  consentAllowsEvent,
  getNotificationConsent,
} from "@/lib/notifications/notification-consent-store";
import { DEFAULT_PREFS, type EventKey } from "@/lib/notifications/prefs";

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
    handleOptionsRequest(res, req);
    return;
  }
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
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

  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host || "localhost:3000";
  const origin = `${proto}://${host}`;

  const results: Record<string, unknown> = {};

  if (wantNostr) {
    try {
      const r = await fetch(`${origin}/api/notifications/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPubkey,
          title,
          message,
          url,
        }),
      });
      results.nostr = {
        status: r.status,
        body: await r.json().catch(() => null),
      };
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
        const r = await fetch(`${origin}/api/notifications/send-telegram`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            title,
            message,
            url,
          }),
        });
        results.telegram = {
          status: r.status,
          body: await r.json().catch(() => null),
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
