# Notification System Testing Guide

This guide explains how to test the notification system to verify that notifications are properly constructed and sent.

## Prerequisites

1. **Environment Variables** - Make sure you have these in your `.env.local`:
   ```bash
   NOSTR_NSEC=nsec1...          # Your Nostr private key (nsec format)
   TELEGRAM_BOT_TOKEN=...       # Your Telegram bot token
   TELEGRAM_CHAT_ID=...         # Your Telegram chat/user ID for testing
   TEST_RECIPIENT_NPUB=npub1... # Optional: Test recipient npub (defaults to 'npub1test')
   ```

2. **Next.js Server Running** - The test script requires the Next.js dev server to be running:
   ```bash
   npm run dev
   ```

## Running the Test

### Option 1: Automated Test Script

Run the comprehensive test script:

```bash
cd ui
node test-notifications.js
```

This will:
- ✅ Check environment variables
- ✅ Test message construction for different event types
- ✅ Send test Nostr notifications (if `NOSTR_NSEC` is configured)
- ✅ Send test Telegram notifications (if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured)
- ✅ Provide a summary of all tests

### Option 2: Manual API Testing

You can also test the API endpoints directly:

#### Test Nostr Notification

```bash
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{
    "testType": "nostr",
    "recipientPubkey": "npub1...",
    "title": "Test Notification",
    "message": "This is a test message",
    "url": "http://localhost:3000/test/repo"
  }'
```

#### Test Telegram Notification

```bash
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{
    "testType": "telegram",
    "telegramUserId": "123456789",
    "title": "Test Notification",
    "message": "This is a test message",
    "url": "http://localhost:3000/test/repo"
  }'
```

#### Test Both

```bash
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{
    "testType": "both",
    "recipientPubkey": "npub1...",
    "telegramUserId": "123456789",
    "title": "Test Notification",
    "message": "This is a test message",
    "url": "http://localhost:3000/test/repo"
  }'
```

## What Gets Tested

### 1. Message Construction
- Verifies that notification messages are properly formatted
- Checks that URLs are included when provided
- Validates message length

### 2. Nostr Notifications
- ✅ Decodes `NOSTR_NSEC` from environment
- ✅ Converts recipient npub to hex (if needed)
- ✅ Encrypts message using NIP-04
- ✅ Creates and signs Kind 4 event
- ✅ Publishes to Nostr relays
- ✅ Returns detailed construction info

### 3. Telegram Notifications
- ✅ Uses `TELEGRAM_BOT_TOKEN` from environment
- ✅ Formats message with title, body, and URL
- ✅ Sends DM to specified user ID
- ✅ Returns detailed construction info

## Expected Output

### Successful Test

```
🧪 Notification System Test Suite
============================================================
Environment check:
  NOSTR_NSEC: ✅ Found
  TELEGRAM_BOT_TOKEN: ✅ Found
  TELEGRAM_CHAT_ID: ✅ Found
  Test Recipient NPUB: npub1...
  Test Telegram User ID: 123456789
============================================================

🔧 Testing Notification Construction: Issue Opened
────────────────────────────────────────────────────────────
Constructed message:
────────────────────────────────────────────────────────────
New issue in test-repo

A new issue "Test Issue" has been opened

http://localhost:3000/test/test-repo/issues/1
────────────────────────────────────────────────────────────
Length: 95 characters
Has URL: true

📨 Testing Nostr Notification: Issue Opened
────────────────────────────────────────────────────────────
✅ Nostr notification sent successfully
   Recipient: npub1...
   Title: New issue in test-repo
   Message: A new issue "Test Issue" has been opened...
   Constructed message length: 95 chars

📱 Testing Telegram Notification: Issue Opened
────────────────────────────────────────────────────────────
✅ Telegram notification sent successfully
   User ID: 123456789
   Title: New issue in test-repo
   Message: A new issue "Test Issue" has been opened...
   Constructed message length: 95 chars

📊 Test Summary
============================================================
Nostr Notifications: 3/3 successful
Telegram Notifications: 3/3 successful
Message Construction: 3/3 successful

✅ Test suite completed!
```

## Troubleshooting

### NOSTR_NSEC not found
- Make sure `NOSTR_NSEC` is in your `.env.local` file
- The value should be in nsec format (starts with `nsec1`)

### TELEGRAM_BOT_TOKEN not found
- Make sure `TELEGRAM_BOT_TOKEN` is in your `.env.local` file
- Get your bot token from [@BotFather](https://t.me/botfather) on Telegram

### TELEGRAM_CHAT_ID not found
- Make sure `TELEGRAM_CHAT_ID` is in your `.env.local` file
- This should be your Telegram user ID (numeric, e.g., `123456789`)
- You can get it by messaging [@userinfobot](https://t.me/userinfobot) on Telegram

### API endpoint not found
- Make sure the Next.js dev server is running (`npm run dev`)
- Check that the server is running on `http://localhost:3000`

### Notification not received
- **Nostr**: Check that the recipient npub is correct and the recipient has access to the relays
- **Telegram**: 
  - Make sure you've started a conversation with your bot first
  - Verify the user ID is correct (should be numeric, not a username)
  - Check that the bot token is valid

## Integration Points

The notification system is integrated at these points:

1. **Issue Events**: When issues are opened/commented
2. **PR Events**: When PRs are opened/reviewed/merged
3. **Bounty Events**: When bounties are funded/released
4. **Repository Events**: When repos are starred/watched/zapped

To trigger notifications in the actual app, these events need to call:
```typescript
import { sendNotification } from '@/lib/notifications';

await sendNotification({
  eventType: 'issue_opened',
  title: 'New issue',
  message: 'Issue description',
  url: 'http://...',
  recipientPubkey: 'npub1...'
});
```

