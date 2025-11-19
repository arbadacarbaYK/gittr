#!/usr/bin/env node

/**
 * Quick script to configure Telegram webhook
 * Usage: node configure-webhook.js <domain>
 * Example: node configure-webhook.js gittr.space
 * Example: node configure-webhook.js abc123.ngrok.io (for local testing)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Simple fetch implementation
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
  const domain = process.argv[2];
  
  if (!domain) {
    console.error('❌ Error: Domain required');
    console.log('Usage: node configure-webhook.js <domain>');
    console.log('Example: node configure-webhook.js gittr.space');
    console.log('Example: node configure-webhook.js abc123.ngrok.io');
    process.exit(1);
  }
  
  // Load .env.local
  const envPath = path.join(__dirname, '.env.local');
  let envVars = {};
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim();
      }
    });
  }
  
  const botToken = envVars.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN not found in .env.local');
    process.exit(1);
  }
  
  // Determine protocol
  const protocol = (domain.includes('localhost') || domain.includes('127.0.0.1') || domain.includes('ngrok')) 
    ? 'https'  // ngrok always uses HTTPS
    : 'https';
  
  const webhookUrl = `${protocol}://${domain}/api/telegram/webhook`;
  
  console.log('🔧 Configuring Telegram webhook...');
  console.log(`   Bot Token: ${botToken.substring(0, 10)}...`);
  console.log(`   Webhook URL: ${webhookUrl}`);
  console.log('');
  
  try {
    // Set webhook
    const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    console.log('📤 Setting webhook...');
    const setResponse = await simpleFetch(setWebhookUrl, { method: 'POST' });
    const setResult = await setResponse.json();
    
    if (setResult.ok) {
      console.log('✅ Webhook configured successfully!');
    } else {
      console.error('❌ Failed to set webhook:', setResult);
      process.exit(1);
    }
    
    console.log('');
    console.log('📊 Checking webhook status...');
    
    // Get webhook info
    const infoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
    const infoResponse = await simpleFetch(infoUrl);
    const infoResult = await infoResponse.json();
    
    if (infoResult.ok) {
      const webhook = infoResult.result;
      console.log('');
      console.log('Webhook Info:');
      console.log(`  URL: ${webhook.url || '(not set)'}`);
      console.log(`  Pending Updates: ${webhook.pending_update_count || 0}`);
      if (webhook.last_error_date) {
        console.log(`  ⚠️  Last Error: ${new Date(webhook.last_error_date * 1000).toISOString()}`);
        console.log(`  Error Message: ${webhook.last_error_message || 'N/A'}`);
      }
      
      if (webhook.pending_update_count > 0) {
        console.log('');
        console.log(`⚠️  There are ${webhook.pending_update_count} pending updates.`);
        console.log('   Telegram will try to deliver them now that the webhook is configured.');
        console.log('   Check your server logs to see if they arrive.');
      }
    }
    
    console.log('');
    console.log('✅ Done!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Make sure the bot is an ADMIN in @gittrspace channel');
    console.log('   2. Make sure the bot has "Post Messages" permission');
    console.log('   3. Post a test message in the channel');
    console.log('   4. Check your server logs for webhook activity');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);

