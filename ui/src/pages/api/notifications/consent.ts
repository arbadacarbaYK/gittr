import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  KIND_NOTIFICATION_PREFS,
  LEGACY_CVE_OPT_IN_D_TAG,
  NOTIFICATION_PREFS_D_TAG,
  getNotificationPrefsDTag,
  parseNotificationPrefsContent,
} from "@/lib/notifications/notification-prefs-event";
import { upsertNotificationConsent } from "@/lib/notifications/notification-consent-store";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Register notification delivery prefs for the server (Telegram userId stays here).
 * POST { event: signed kind 30078, telegramUserId? }
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

  const { event, telegramUserId } = req.body || {};
  if (!event || typeof event !== "object") {
    return res.status(400).json({
      error: "missing_event",
      message: "Signed kind 30078 event required",
    });
  }

  try {
    const { validateEvent, verifySignature } = await import("nostr-tools");
    if (!validateEvent(event) || !verifySignature(event)) {
      return res.status(400).json({ error: "invalid_signature" });
    }
  } catch (e) {
    console.error("[notifications/consent] verify failed:", e);
    return res.status(400).json({ error: "invalid_event" });
  }

  if (event.kind !== KIND_NOTIFICATION_PREFS) {
    return res.status(400).json({ error: "wrong_kind" });
  }
  const d = getNotificationPrefsDTag(event);
  if (d !== NOTIFICATION_PREFS_D_TAG && d !== LEGACY_CVE_OPT_IN_D_TAG) {
    return res.status(400).json({ error: "wrong_d_tag" });
  }

  const prefs = parseNotificationPrefsContent(event.content);
  if (!prefs) {
    return res.status(400).json({ error: "invalid_content" });
  }

  const pubkey = String(event.pubkey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: "invalid_pubkey" });
  }

  const tgId =
    typeof telegramUserId === "string" ? telegramUserId.trim() : "";
  if (prefs.channels.telegram.enabled && !tgId) {
    return res.status(400).json({
      error: "telegram_userid_required",
      message:
        "Telegram channel is enabled — paste your Telegram User ID in Settings",
    });
  }

  const record = upsertNotificationConsent(pubkey, {
    nostr: prefs.channels.nostr.enabled,
    telegram: prefs.channels.telegram.enabled,
    telegramUserId: prefs.channels.telegram.enabled ? tgId : undefined,
    events: { ...prefs.events },
  });

  return res.status(200).json({
    status: "ok",
    pubkey,
    consent: {
      nostr: record.nostr,
      telegram: record.telegram,
      hasTelegramUserId: !!record.telegramUserId,
      security_cve: !!record.events.security_cve,
      updatedAt: record.updatedAt,
    },
  });
}
