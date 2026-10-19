import {
  formatTelegramNotificationHtml,
  telegramSendMessage,
} from "./telegram-api";

/** Telegram chat ids are integers. Channels are negative (-100…). */
export function isTelegramChatId(value: string): boolean {
  return /^-?\d{1,20}$/.test(value);
}

export async function sendTelegramDmToChat(opts: {
  chatId: string;
  title: string;
  message: string;
  url?: string;
}): Promise<{ ok: true; messageId?: number } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "not_configured" };
  if (!isTelegramChatId(opts.chatId))
    return { ok: false, error: "invalid_chat" };

  const { html } = formatTelegramNotificationHtml({
    title: opts.title,
    message: opts.message,
    url: opts.url,
    linkLabel: "View details",
  });

  const result = await telegramSendMessage({
    botToken: token,
    chatId: opts.chatId,
    text: html,
    parseMode: "HTML",
    disableWebPagePreview: true,
  });

  if (!result.ok) {
    console.warn("Telegram DM failed:", result.error);
    return { ok: false, error: "send_failed" };
  }

  return { ok: true, messageId: result.messageId };
}

const channelHits: number[] = [];
const CHANNEL_WINDOW_MS = 60 * 60 * 1000;
const CHANNEL_MAX_PER_WINDOW = 30;

function channelAnnouncementAllowed(): boolean {
  const now = Date.now();
  while (channelHits.length > 0 && now - channelHits[0]! > CHANNEL_WINDOW_MS) {
    channelHits.shift();
  }
  if (channelHits.length >= CHANNEL_MAX_PER_WINDOW) return false;
  channelHits.push(now);
  return true;
}

/**
 * Public channel post after a real bounty payment on the server.
 * No caller-supplied link. Text is escaped. Never throws.
 */
export async function announceBountyOnTelegramChannel(opts: {
  kind: "funded" | "released";
  title?: string;
  amountSats?: number;
}): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || "";
    if (!token || !isTelegramChatId(chatId)) return;
    if (!channelAnnouncementAllowed()) {
      console.warn("Telegram channel announcement skipped: rate limit");
      return;
    }

    const amount = Number(opts.amountSats);
    const amountSats = Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount))
      : 0;
    const plainTitle = String(opts.title || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);

    const title =
      opts.kind === "funded"
        ? plainTitle
          ? `Bounty funded: ${plainTitle}`
          : "Bounty funded"
        : "Bounty released";
    const message =
      amountSats > 0
        ? `Amount: ${amountSats} sats`
        : opts.kind === "funded"
        ? "A bounty was funded on gittr."
        : "A bounty was released on gittr.";

    const { html } = formatTelegramNotificationHtml({ title, message });
    const result = await telegramSendMessage({
      botToken: token,
      chatId,
      text: html,
      parseMode: "HTML",
      disableWebPagePreview: true,
    });
    if (!result.ok) {
      console.warn("Telegram channel announcement failed:", result.error);
    }
  } catch (error) {
    console.warn("Telegram channel announcement error:", error);
  }
}
