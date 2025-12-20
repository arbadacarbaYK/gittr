#!/bin/bash

# Comprehensive test script for Telegram webhook and notifications
# This tests both the webhook endpoint and the notification system
#
# See docs/TEST_FILES_REFERENCE.md for full documentation

echo "🧪 Testing Telegram Webhook & Notification System"
echo "=================================================="
echo ""

# Get script directory (works from any location)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Check configuration
echo "📋 Configuration Check:"
echo "   TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:0:20}..."
echo "   TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID}"
echo "   NOSTR_NSEC: ${NOSTR_NSEC:0:20}..."
echo ""

# Test 1: Webhook endpoint (simulated)
echo "🔹 Test 1: Testing webhook endpoint (simulated message)..."
node test-webhook-manually.js
echo ""

# Test 2: Notification system
echo "🔹 Test 2: Testing notification system..."
echo "   This will send REAL notifications!"
echo "   Make sure you have:"
echo "   - TEST_RECIPIENT_NPUB set in .env.local (for Nostr)"
echo "   - TEST_TELEGRAM_USER_ID set in .env.local (for Telegram)"
echo ""
read -p "   Continue with notification tests? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  node test-notifications.js
else
  echo "   Skipped notification tests"
fi

echo ""
echo "✅ Test suite complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Configure webhook URL (requires ngrok or production domain)"
echo "   2. Post a test message in @gittrspace"
echo "   3. Check server logs for webhook activity"

