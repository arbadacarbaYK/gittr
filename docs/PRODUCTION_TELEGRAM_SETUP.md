# Telegram Setup Guide - Production & Local Testing

## Quick Answer

- **Production**: NO ngrok needed! Configure webhook directly to your domain.
- **Local Testing**: Use ngrok to expose localhost:3000.
- **Personal DMs**: `@gittrupdatebot` — `/start` returns the user's Telegram User ID (private).
- **Public channel**: `@gittrspace` — announcements only (bounties, etc.). Not used for auth.

---

## Production Setup

### 1. Configure Environment Variables

In production env only (never commit real tokens):

```bash
# Telegram Bot Token (get from @BotFather) — NEVER commit the real token!
TELEGRAM_BOT_TOKEN=123456789:REPLACE_WITH_TOKEN_FROM_BOTFATHER

# Public announcements channel (@gittrspace). Usually -100…
TELEGRAM_CHAT_ID=-100REPLACE_WITH_CHANNEL_ID
```

### 2. Get Channel ID

```bash
cd ui
node get-channel-id.js
```

### 3. Configure Webhook (Production)

```bash
cd ui
node configure-webhook.js gittr.space
```

### 4. Verify

```bash
curl https://gittr.space/api/telegram/webhook-status
```

Should show webhook URL `https://gittr.space/api/telegram/webhook`.

### 5. Link a user for personal DMs

1. User opens `@gittrupdatebot` and sends `/start`
2. Bot replies privately with their Telegram User ID
3. User pastes that ID into Settings → Notifications

No public channel post is required. The webhook ignores channel posts for auth.

**History tip:** Clearing or deleting the chat with `@gittrupdatebot` removes past DMs from Telegram’s view. `/start` only re-shows the User ID onboarding — it does not re-send old alerts. Server logs should include a Telegram `messageId` when a DM was truly accepted.

**Delivery checks:** personal DMs go through `POST /api/notifications/deliver`. The server looks up that person’s saved Telegram id and only treats a send as success when Telegram’s JSON says `ok: true` (it returns `messageId`). `deliver` reports `partial` / `failed` when a requested channel errors.

---

## Roles

| Piece | Purpose |
| --- | --- |
| `@gittrupdatebot` | Personal notification DMs (same bot for everyone; each chat is private) |
| `@gittrspace` + `TELEGRAM_CHAT_ID` | Public announcements only |

For announcements, add the bot as channel admin with **Post Messages**.

---

## Local Testing

```bash
/tmp/ngrok http 3000
cd ui && node configure-webhook.js <ngrok-host>
```

Then DM `/start` and confirm a clean HTML User ID reply.

---

## Security

- Never commit real `TELEGRAM_BOT_TOKEN` values
- Keep live tokens in production env only
- Do not use the public channel as an auth surface
- These routes do **not** send Telegram messages. They answer `401` (or `404` for the test route in production) before the bot token is used:
  - `POST /api/notifications/send-telegram`
  - `POST /api/notifications/send-telegram-channel`
  - `POST /api/notifications/test` (local only, and only when `NOTIFICATIONS_TEST_ENABLED=1`; always off when `NODE_ENV=production`)
  - `POST /api/notifications/send` (platform Nostr key — same rule)
- A browser cannot choose the Telegram chat id. `deliver` uses the id stored when that person saved Settings → Notifications.
- Public channel posts happen only after a bounty withdraw link is created or a bounty payment succeeds. The text is plain (HTML-escaped) and there is no caller-supplied link.
- CORS on these routes is same-origin, not `*`.
- Set `TELEGRAM_WEBHOOK_SECRET` in production `.env.local` and register it with `node configure-webhook.js gittr.space` (the script sends it as Telegram’s `secret_token` and does not print it). The webhook then rejects posts that omit `X-Telegram-Bot-Api-Secret-Token`. Until that variable is set, `/start` still works and a forged webhook update can ask the bot to reply.
