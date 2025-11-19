#!/usr/bin/env node

/**
 * Manually test the webhook endpoint by simulating a Telegram update
 * Usage: node test-webhook-manually.js
 */

const http = require('http');
const https = require('https');

function simpleFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function main() {
  // Simulate a Telegram channel post update for @gittrspace
  const testUpdate = {
    update_id: 999999999,
    channel_post: {
      message_id: 123,
      chat: {
        id: -1003473049390, // Channel ID for @gittrspace (negative with -100 prefix)
        title: "gittr.space",
        username: "gittrspace",
        type: "channel"
      },
      date: Math.floor(Date.now() / 1000),
      text: "Verifying that I control the following Nostr public key: \"npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc\""
    }
  };

  console.log('🧪 Testing webhook endpoint manually...');
  console.log('   Sending test update to: http://localhost:3000/api/telegram/webhook');
  console.log('   Simulated channel post with verification message');
  console.log('');

  try {
    const response = await simpleFetch('http://localhost:3000/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUpdate),
    });

    const responseText = await response.text();
    
    console.log('Response Status:', response.status, response.statusText);
    console.log('Response Body:', responseText);
    console.log('');
    
    if (response.ok) {
      console.log('✅ Webhook endpoint responded successfully!');
      console.log('   Check your server logs for detailed processing info.');
    } else {
      console.log('❌ Webhook endpoint returned an error');
    }
  } catch (error) {
    console.error('❌ Error calling webhook:', error.message);
    console.log('');
    console.log('Make sure:');
    console.log('  1. Next.js dev server is running (npm run dev)');
    console.log('  2. Server is listening on http://localhost:3000');
  }
}

main().catch(console.error);

