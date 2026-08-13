/**
 * Shared Telegram Bot API helpers for DM / channel sends.
 * Telegram often returns HTTP 4xx with `{ ok: false }`, but callers must
 * always require `ok === true` — never treat HTTP status alone as success.
 */

export type TelegramSendResult =
  | { ok: true; messageId?: number; raw: unknown }
  | { ok: false; error: string; httpStatus: number; raw: unknown };

export function escapeTelegramHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function telegramSendMessage(opts: {
  botToken: string;
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  disableWebPagePreview?: boolean;
}): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    text: opts.text,
    disable_web_page_preview: opts.disableWebPagePreview ?? true,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;

  let httpStatus = 0;
  let raw: unknown = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    raw = await res.json().catch(() => null);
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      httpStatus: 0,
      raw: null,
    };
  }

  const data = raw as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  } | null;

  if (!data || data.ok !== true) {
    return {
      ok: false,
      error: data?.description || `Telegram API rejected send (HTTP ${httpStatus})`,
      httpStatus,
      raw,
    };
  }

  return {
    ok: true,
    messageId:
      typeof data.result?.message_id === "number"
        ? data.result.message_id
        : undefined,
    raw,
  };
}

export function emojiForNotificationTitle(title: string): string {
  const titleLower = title.toLowerCase();
  if (
    titleLower.includes("security") ||
    titleLower.includes("vulnerabilit") ||
    titleLower.includes("advisory") ||
    titleLower.includes("dependency notice") ||
    titleLower.includes("[deps]")
  )
    return "📋";
  if (titleLower.includes("bounty")) return "💰";
  if (titleLower.includes("pull request") || titleLower.includes("pr"))
    return "🔀";
  if (titleLower.includes("issue")) return "📝";
  if (titleLower.includes("merged")) return "✅";
  if (titleLower.includes("comment")) return "💬";
  return "🔔";
}

export function formatTelegramNotificationHtml(opts: {
  title: string;
  message: string;
  url?: string;
  linkLabel?: string;
}): { emoji: string; html: string } {
  const emoji = emojiForNotificationTitle(opts.title);
  const linkLabel = opts.linkLabel || "Open";
  const escapedUrl = opts.url ? escapeTelegramHtml(opts.url) : "";
  const linkText = opts.url
    ? `<a href="${escapedUrl}">${escapeTelegramHtml(linkLabel)}</a>`
    : "";
  const html = `${emoji} <b>${escapeTelegramHtml(opts.title)}</b>\n\n${escapeTelegramHtml(
    opts.message
  )}${opts.url ? `\n\n${linkText}` : ""}`;
  return { emoji, html };
}
