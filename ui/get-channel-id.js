#!/usr/bin/env node

/**
 * Get the actual channel ID from Telegram API
 * Usage: node get-channel-id.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function simpleFetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
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
  const currentChatId = envVars.TELEGRAM_CHAT_ID;
  
  if (!botToken) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN not found in .env.local');
    process.exit(1);
  }
  
  console.log('🔍 Getting channel info from Telegram...');
  console.log(`   Current TELEGRAM_CHAT_ID: ${currentChatId || '(not set)'}`);
  console.log('');
  
  try {
    // Try to get channel info by username
    const username = '@gittrspace';
    console.log(`📡 Fetching info for ${username}...`);
    const result = await simpleFetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${username}`);
    
    if (result.ok) {
      const chat = result.result;
      console.log('');
      console.log('✅ Channel Info:');
      console.log(`   Title: ${chat.title}`);
      console.log(`   Type: ${chat.type}`);
      console.log(`   Username: ${chat.username || '(none)'}`);
      console.log(`   ID: ${chat.id}`);
      console.log('');
      
      if (chat.id.toString() !== currentChatId) {
        console.log('⚠️  WARNING: Channel ID mismatch!');
        console.log(`   Configured in .env.local: ${currentChatId}`);
        console.log(`   Actual from Telegram API: ${chat.id}`);
        console.log('');
        console.log('💡 Update your .env.local:');
        console.log(`   TELEGRAM_CHAT_ID=${chat.id}`);
      } else {
        console.log('✅ Channel ID matches .env.local');
      }
      
      // Note about negative IDs
      if (chat.id < 0) {
        console.log('');
        console.log('ℹ️  Note: Channel IDs are negative in Telegram API');
        console.log('   This is normal - the code handles both positive and negative formats');
      }
    } else {
      console.error('❌ Failed to get channel info:', result);
      console.log('');
      console.log('Possible reasons:');
      console.log('  1. Bot is not a member of the channel');
      console.log('  2. Channel username is incorrect');
      console.log('  3. Bot needs to be added as admin');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);

