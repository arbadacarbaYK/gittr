# Telegram Setup Guide - Production & Local Testing

## Quick Answer

- **Production**: NO ngrok needed! Configure webhook directly to your domain.
- **Local Testing**: Use ngrok to expose localhost:3000.

---

## Production Setup

### 1. Configure Environment Variables

In `ui/.env.local` (or your production environment):

```bash
# Telegram Bot Token (get from @BotFather)
TELEGRAM_BOT_TOKEN=7972195915:AAHK03RXPeDMt95QxgBYCEFnTqSLIl9gUa8

# Telegram Channel ID (get by running: node ui/get-channel-id.js)
# Example: -1003473049390 (for @gittrspace channel)
TELEGRAM_CHAT_ID=-1003473049390
```

### 2. Get Channel ID

```bash
cd ui
node get-channel-id.js
```

This will show the correct channel ID (usually negative with `-100` prefix).

### 3. Configure Webhook (Production)

**After your server is deployed and accessible at `https://gittr.space`:**

```bash
cd ui
node configure-webhook.js gittr.space
```

**That's it!** No ngrok needed in production.

### 4. Verify Webhook is Configured

```bash
curl https://gittr.space/api/telegram/webhook-status
```

Should show:
- `webhookConfigured: true`
- `webhookUrl: "https://gittr.space/api/telegram/webhook"`
- `pendingUpdateCount: 0` (or decreasing as updates are delivered)

### 5. Test Verification Flow

1. **Post in channel** `@gittrspace`:
   ```
   Verifying that I control the following Nostr public key: "npub1..."
   ```

2. **Bot replies in channel** with message ID

3. **DM the bot** (`@ngitspacebot`) with `/start`

4. **Bot sends DM** with both User ID and Message ID

---

## Bot Permissions Required

The bot must be an **admin** in the channel with:
- ✅ **Post Messages** (required to reply in channel)
- ✅ **Read Messages** (automatic)

**To check/update:**
1. Open channel `@gittrspace`
2. Settings → Administrators
3. Find `@ngitspacebot`
4. Ensure "Post Messages" is enabled

---

## What Works in Production

✅ **Notifications** (PRs, Issues, Bounties)
- Sends DMs to users based on their notification preferences
- Bounties also post to public channel
- Works immediately after deployment

✅ **Verification Bot** (NIP-39)
- Monitors channel for verification messages
- Replies in channel with message ID
- Sends DMs with User ID + Message ID
- **Requires webhook to be configured** (step 3 above)

---

## Troubleshooting

### Webhook not receiving updates?
- Check webhook status: `curl https://gittr.space/api/telegram/webhook-status`
- Verify webhook URL is correct
- Check server logs for incoming requests
- Ensure bot is admin in channel

### Bot not replying in channel?
- Check bot has "Post Messages" permission
- Verify `TELEGRAM_CHAT_ID` is correct (use `get-channel-id.js`)
- Check server logs for webhook activity

### Verification DM not working?
- User must DM bot first (`/start`)
- Bot matches npub from channel post to DM
- Cache expires after 1 hour - user should DM bot soon after posting

---

## Local Testing Setup

### Step 1: Start ngrok

In a **separate terminal**, run:

```bash
/tmp/ngrok http 3000
```

You'll see output like:
```
Forwarding   https://abc123.ngrok.io -> http://localhost:3000
```

**Copy the HTTPS URL** (e.g., `abc123.ngrok.io` - without the `https://`)

**Note**: If ngrok requires authentication:
```bash
/tmp/ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```
Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken

### Step 2: Configure Webhook

In another terminal:

```bash
cd ui
node configure-webhook.js abc123.ngrok.io
```

Replace `abc123.ngrok.io` with your actual ngrok URL.

### Step 3: Verify

```bash
curl http://localhost:3000/api/telegram/webhook-status
```

Should show `webhookConfigured: true` and `webhookUrl` with your ngrok URL.

### Step 4: Test Verification

1. Post in channel `@gittrspace`:
   ```
   Verifying that I control the following Nostr public key: npub1...
   ```
   (With or without quotes - both work!)

2. Bot should reply in channel with message ID

3. DM bot (`@ngitspacebot`) with `/start`

4. Bot sends DM with User ID + Message ID

---

## Summary

- **Production**: Configure webhook directly → `node configure-webhook.js gittr.space`
- **Local Testing**: Use ngrok → `node configure-webhook.js <ngrok-url>`
- **No ngrok in production!** Server is already publicly accessible.

