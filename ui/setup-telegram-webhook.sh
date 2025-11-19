#!/bin/bash

# Script to configure Telegram bot webhook
# Usage: ./setup-telegram-webhook.sh <your-domain>

if [ -z "$1" ]; then
  echo "Usage: ./setup-telegram-webhook.sh <your-domain>"
  echo "Example: ./setup-telegram-webhook.sh gittr.space"
  echo "Example: ./setup-telegram-webhook.sh localhost:3000 (for local testing with ngrok)"
  exit 1
fi

DOMAIN=$1

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "❌ Error: TELEGRAM_BOT_TOKEN not found in .env.local"
  exit 1
fi

# Determine protocol
if [[ "$DOMAIN" == *"localhost"* ]] || [[ "$DOMAIN" == *"127.0.0.1"* ]]; then
  PROTOCOL="http"
else
  PROTOCOL="https"
fi

WEBHOOK_URL="${PROTOCOL}://${DOMAIN}/api/telegram/webhook"

echo "🔧 Setting up Telegram webhook..."
echo "   Bot Token: ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "   Webhook URL: $WEBHOOK_URL"
echo ""

# Set webhook
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}")

echo "Response: $RESPONSE"
echo ""

# Check webhook status
echo "📊 Checking webhook status..."
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq '.'

echo ""
echo "✅ Done! If webhook is configured, you should see 'url' in the response above."
echo ""
echo "⚠️  Important:"
echo "   1. Make sure your bot is an ADMIN in the channel (@gittrspace)"
echo "   2. The bot needs 'Post Messages' permission to reply"
echo "   3. For localhost testing, use ngrok: ngrok http 3000"

