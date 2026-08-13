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

**Delivery checks:** `POST /api/notifications/send-telegram` requires Telegram’s JSON `ok: true` (not only HTTP status) and returns `messageId`. `POST /api/notifications/deliver` reports `partial` / `failed` when a requested channel errors.

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
