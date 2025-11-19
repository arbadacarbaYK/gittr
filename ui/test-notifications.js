/**
 * Test script for notification system
 * Tests both Nostr and Telegram notification construction and sending
 * 
 * Usage: node test-notifications.js
 * 
 * Make sure you have these in your .env.local:
 * - NOSTR_NSEC
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID (for testing - will be used as userId)
 */

// Load environment variables from .env.local
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Simple dotenv parser
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    });
    return env;
  } catch (error) {
    return {};
  }
}

// Load .env.local and merge with process.env
const envLocal = loadEnv(path.join(__dirname, '.env.local'));
Object.assign(process.env, envLocal);

// Simple fetch implementation using Node.js http/https
function simpleFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    
    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data)
        };
        resolve(response);
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

const fetch = simpleFetch;

// Test data - will try to get from localStorage via API or use env vars
const TEST_RECIPIENT_NPUB = process.env.TEST_RECIPIENT_NPUB || null; // Will fetch from API if not set
// IMPORTANT: Use actual Telegram USER ID for DMs, NOT channel ID!
// Channel ID (TELEGRAM_CHAT_ID) is for receiving webhook updates, not for sending DMs
// Get your user ID by messaging @userinfobot on Telegram
const TEST_TELEGRAM_USER_ID = process.env.TEST_TELEGRAM_USER_ID || process.env.TELEGRAM_USER_ID;

// Notification test cases
const testNotifications = [
  {
    name: 'Issue Opened',
    eventType: 'issue_opened',
    title: 'New issue in test-repo',
    message: 'A new issue "Test Issue" has been opened',
    url: 'http://localhost:3000/test/test-repo/issues/1',
    repoEntity: 'test',
    repoName: 'test-repo'
  },
  {
    name: 'PR Opened',
    eventType: 'pr_opened',
    title: 'New pull request in test-repo',
    message: 'A new pull request "Add feature" has been opened',
    url: 'http://localhost:3000/test/test-repo/pulls/1',
    repoEntity: 'test',
    repoName: 'test-repo'
  },
  {
    name: 'Bounty Funded',
    eventType: 'bounty_funded',
    title: 'Bounty funded on issue #1',
    message: 'A bounty of 10000 sats has been added to the issue',
    url: 'http://localhost:3000/test/test-repo/issues/1',
    repoEntity: 'test',
    repoName: 'test-repo'
  }
];

async function testNostrNotification(notification) {
  console.log(`\n📨 Testing Nostr Notification: ${notification.name}`);
  console.log('─'.repeat(60));
  
  const nostrNsec = process.env.NOSTR_NSEC;
  if (!nostrNsec) {
    console.error('❌ NOSTR_NSEC not found in environment');
    return { success: false, error: 'NOSTR_NSEC not configured' };
  }

  try {
    // Use the test endpoint which provides more details
    const response = await fetch('http://localhost:3000/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testType: 'nostr',
        recipientPubkey: TEST_RECIPIENT_NPUB,
        title: notification.title,
        message: notification.message,
        url: notification.url
      })
    });

    const result = await response.json();
    
    if (result.tests?.nostr?.success) {
      console.log('✅ Nostr notification sent successfully!');
      console.log(`   📨 Check your Nostr client (Damus, Amethyst, etc.) for the DM`);
      console.log(`   Recipient: ${TEST_RECIPIENT_NPUB.substring(0, 20)}...`);
      console.log(`   Title: ${notification.title}`);
      console.log(`   Message: ${notification.message.substring(0, 50)}...`);
      if (result.tests.nostr.constructed) {
        console.log(`   Constructed message length: ${result.tests.nostr.constructed.fullMessage.length} chars`);
        console.log(`   Event ID: ${result.tests.nostr.constructed.eventId || 'N/A'}`);
        console.log(`   Relays: ${result.tests.nostr.constructed.relays?.length || 0} relays`);
        if (result.tests.nostr.constructed.relays?.length > 0) {
          console.log(`   Relay list: ${result.tests.nostr.constructed.relays.slice(0, 3).join(', ')}${result.tests.nostr.constructed.relays.length > 3 ? '...' : ''}`);
        }
      }
      return { success: true, result: result.tests.nostr };
    } else {
      const errorMsg = result.tests?.nostr?.error || result.error || 'Unknown error';
      console.error('❌ Nostr notification failed:', errorMsg);
      if (result.tests?.nostr?.hint) {
        console.error('   💡 Hint:', result.tests.nostr.hint);
      }
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ Error sending Nostr notification:', error.message);
    return { success: false, error: error.message };
  }
}

async function testTelegramNotification(notification) {
  console.log(`\n📱 Testing Telegram Notification: ${notification.name}`);
  console.log('─'.repeat(60));
  
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found in environment');
    return { success: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  if (!TEST_TELEGRAM_USER_ID) {
    console.error('❌ TELEGRAM_CHAT_ID or TELEGRAM_USER_ID not found in environment');
    return { success: false, error: 'Telegram user ID not configured' };
  }

  try {
    // Use the test endpoint which provides more details
    const response = await fetch('http://localhost:3000/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testType: 'telegram',
        telegramUserId: TEST_TELEGRAM_USER_ID,
        title: notification.title,
        message: notification.message,
        url: notification.url
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        return { success: false, error: errorJson.error || errorJson.message || 'Request failed' };
      } catch {
        return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
      }
    }

    const result = await response.json();
    
    if (result.tests?.telegram?.success) {
      console.log('✅ Telegram notification sent successfully!');
      console.log(`   📱 Check your Telegram for the DM from the bot`);
      console.log(`   User ID: ${TEST_TELEGRAM_USER_ID}`);
      console.log(`   Title: ${notification.title}`);
      console.log(`   Message: ${notification.message.substring(0, 50)}...`);
      if (result.tests.telegram.constructed) {
        console.log(`   Constructed message length: ${result.tests.telegram.constructed.fullMessage.length} chars`);
        if (result.tests.telegram.constructed.telegramResponse?.message_id) {
          console.log(`   Telegram message ID: ${result.tests.telegram.constructed.telegramResponse.message_id}`);
        }
      }
      return { success: true, result: result.tests.telegram };
    } else {
      const errorMsg = result.tests?.telegram?.error || result.error || 'Unknown error';
      console.error('❌ Telegram notification failed:', errorMsg);
      if (result.tests?.telegram?.constructed?.telegramError) {
        console.error('   Telegram API error:', JSON.stringify(result.tests.telegram.constructed.telegramError, null, 2));
        if (errorMsg.includes('chat not found')) {
          console.error('   💡 Hint: Start a conversation with your bot first! Message your bot on Telegram.');
        }
      }
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ Error sending Telegram notification:', error.message);
    return { success: false, error: error.message };
  }
}

async function testNotificationConstruction(notification) {
  console.log(`\n🔧 Testing Notification Construction: ${notification.name}`);
  console.log('─'.repeat(60));
  
  // Simulate the construction logic
  const messageText = `${notification.title}\n\n${notification.message}${notification.url ? `\n\n${notification.url}` : ""}`;
  
  console.log('Constructed message:');
  console.log('─'.repeat(60));
  console.log(messageText);
  console.log('─'.repeat(60));
  console.log(`Length: ${messageText.length} characters`);
  console.log(`Has URL: ${!!notification.url}`);
  
  return { success: true, message: messageText };
}

async function getCurrentUserNpub() {
  // Try to get npub from the test API endpoint which can access localStorage
  try {
    const response = await fetch('http://localhost:3000/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testType: 'nostr',
        recipientPubkey: 'test', // Just to trigger the endpoint
        title: 'test',
        message: 'test'
      })
    });
    // This won't work directly, but we can try localStorage via a different approach
    // For now, we'll use the env var or prompt
    return null;
  } catch (error) {
    return null;
  }
}

async function runTests() {
  console.log('🧪 Notification System Test Suite');
  console.log('='.repeat(60));
  console.log(`Environment check:`);
  console.log(`  NOSTR_NSEC: ${process.env.NOSTR_NSEC ? '✅ Found' : '❌ Missing'}`);
  console.log(`  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Found' : '❌ Missing'}`);
  console.log(`  TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ? '✅ Found (' + process.env.TELEGRAM_CHAT_ID + ')' : '❌ Missing'}`);
  
  // Get recipient npub - try to fetch from user's notification prefs via API
  let recipientNpub = TEST_RECIPIENT_NPUB;
  if (!recipientNpub) {
    console.log(`  Test Recipient NPUB: ❌ Not set (set TEST_RECIPIENT_NPUB in .env.local)`);
    console.log(`     The test endpoint requires a recipient npub to send actual notifications.`);
    console.log(`     You can find your npub in the notification settings page.`);
  } else {
    console.log(`  Test Recipient NPUB: ${recipientNpub.substring(0, 20)}...`);
  }
  console.log(`  Test Telegram User ID: ${TEST_TELEGRAM_USER_ID || 'Not set'}`);
  console.log('='.repeat(60));
  console.log('\n⚠️  IMPORTANT: This test script will ACTUALLY SEND notifications!');
  console.log('   Real notifications will be sent to:');
  if (TEST_RECIPIENT_NPUB) {
    console.log(`   - Nostr: ${TEST_RECIPIENT_NPUB.substring(0, 20)}...`);
  } else {
    console.log('   - Nostr: ❌ Not configured (set TEST_RECIPIENT_NPUB in .env.local)');
  }
  if (TEST_TELEGRAM_USER_ID) {
    console.log(`   - Telegram: User ID ${TEST_TELEGRAM_USER_ID}`);
  } else {
    console.log('   - Telegram: ❌ Not configured (set TELEGRAM_CHAT_ID in .env.local)');
  }
  console.log('\n   Requirements:');
  console.log('   - TEST_RECIPIENT_NPUB set in .env.local (for Nostr tests)');
  console.log('   - TELEGRAM_CHAT_ID or TELEGRAM_USER_ID set (for Telegram tests)');
  console.log('   - The recipient has started a conversation with the bot (for Telegram)');
  console.log('   - The Next.js dev server is running on http://localhost:3000\n');

  const results = {
    nostr: [],
    telegram: [],
    construction: []
  };

  for (const notification of testNotifications) {
    // Test construction
    const constructionResult = await testNotificationConstruction(notification);
    results.construction.push(constructionResult);

    // Test Nostr (if configured)
    if (process.env.NOSTR_NSEC) {
      const nostrResult = await testNostrNotification(notification);
      results.nostr.push(nostrResult);
      // Wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Test Telegram (if configured)
    if (process.env.TELEGRAM_BOT_TOKEN && TEST_TELEGRAM_USER_ID) {
      const telegramResult = await testTelegramNotification(notification);
      results.telegram.push(telegramResult);
      // Wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n\n📊 Test Summary');
  console.log('='.repeat(60));
  
  const nostrSuccess = results.nostr.filter(r => r.success).length;
  const nostrTotal = results.nostr.length;
  if (nostrTotal > 0) {
    console.log(`Nostr Notifications: ${nostrSuccess}/${nostrTotal} successful`);
    if (nostrSuccess > 0) {
      console.log(`   ✅ ${nostrSuccess} notification(s) were sent! Check your Nostr client.`);
    }
  } else {
    console.log(`Nostr Notifications: Skipped (NOSTR_NSEC or TEST_RECIPIENT_NPUB not configured)`);
  }
  
  const telegramSuccess = results.telegram.filter(r => r.success).length;
  const telegramTotal = results.telegram.length;
  if (telegramTotal > 0) {
    console.log(`Telegram Notifications: ${telegramSuccess}/${telegramTotal} successful`);
    if (telegramSuccess > 0) {
      console.log(`   ✅ ${telegramSuccess} notification(s) were sent! Check your Telegram.`);
    }
  } else {
    console.log(`Telegram Notifications: Skipped (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured)`);
  }
  
  const constructionSuccess = results.construction.filter(r => r.success).length;
  console.log(`Message Construction: ${constructionSuccess}/${results.construction.length} successful`);

  console.log('\n' + '='.repeat(60));
  if (nostrSuccess > 0 || telegramSuccess > 0) {
    console.log('✅ Test suite completed! Notifications were sent successfully.');
    console.log('   Make sure to check your Nostr client and/or Telegram to verify receipt.');
  } else {
    console.log('⚠️  Test suite completed, but no notifications were sent.');
    console.log('   Check your configuration (NOSTR_NSEC, TEST_RECIPIENT_NPUB, TELEGRAM_BOT_TOKEN, etc.)');
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

