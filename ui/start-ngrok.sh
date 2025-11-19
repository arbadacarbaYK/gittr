#!/bin/bash

# Start ngrok tunnel for local Telegram webhook testing
# Usage: ./start-ngrok.sh

NGROK_PATH="/tmp/ngrok"

if [ ! -f "$NGROK_PATH" ]; then
  echo "❌ ngrok not found at $NGROK_PATH"
  echo "   Download it first or update the path in this script"
  exit 1
fi

echo "🚀 Starting ngrok tunnel to localhost:3000..."
echo "   This will expose your local server to the internet"
echo "   Press Ctrl+C to stop"
echo ""

# Start ngrok in background and capture the URL
$NGROK_PATH http 3000 > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

echo "⏳ Waiting for ngrok to start..."
sleep 5

# Get the public URL
PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tunnels = [t for t in data.get('tunnels', []) if t['proto'] == 'https']
    if tunnels:
        print(tunnels[0]['public_url'])
except:
    pass
" 2>/dev/null)

if [ -z "$PUBLIC_URL" ]; then
  echo "❌ Failed to get ngrok URL. Check /tmp/ngrok.log for errors"
  kill $NGROK_PID 2>/dev/null
  exit 1
fi

echo ""
echo "✅ ngrok is running!"
echo "   Public URL: $PUBLIC_URL"
echo "   Local URL: http://localhost:3000"
echo ""
echo "📋 Next steps:"
echo "   1. Configure the webhook:"
echo "      cd ui && node configure-webhook.js $(echo $PUBLIC_URL | sed 's|https://||')"
echo ""
echo "   2. Or manually:"
echo "      curl -X POST \"https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=${PUBLIC_URL}/api/telegram/webhook\""
echo ""
echo "   3. Test by posting a message in @gittrspace"
echo ""
echo "   Press Ctrl+C to stop ngrok"
echo ""

# Wait for user to stop
trap "echo ''; echo '🛑 Stopping ngrok...'; kill $NGROK_PID 2>/dev/null; exit 0" INT TERM

# Keep script running
wait $NGROK_PID

