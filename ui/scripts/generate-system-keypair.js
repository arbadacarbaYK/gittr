#!/usr/bin/env node

/**
 * Generate a Nostr keypair for the system account
 * This is used for sharing repositories to Nostr without requiring user login
 * 
 * Usage: node scripts/generate-system-keypair.js
 */

const { generatePrivateKey, getPublicKey, nip19 } = require('nostr-tools');

console.log('🔑 Generating system Nostr keypair for gittr...\n');

try {
  // Generate private key (hex)
  const privateKey = generatePrivateKey();
  
  // Get public key from private key
  const publicKey = getPublicKey(privateKey);
  
  // Encode to nsec1 and npub1 formats
  const nsec = nip19.nsecEncode(privateKey);
  const npub = nip19.npubEncode(publicKey);
  
  console.log('✅ Keypair generated successfully!\n');
  console.log('📝 Add these to your .env.local file:\n');
  console.log(`NEXT_PUBLIC_SYSTEM_NSEC=${nsec}`);
  console.log(`NEXT_PUBLIC_SYSTEM_NPUB=${npub}\n`);
  console.log('⚠️  IMPORTANT: Keep the NSEC secret secure! Never commit it to git.\n');
  console.log('ℹ️  The system account will be used to share repositories to Nostr');
  console.log('   when users are not logged in.\n');
  
} catch (error) {
  console.error('❌ Error generating keypair:', error.message);
  process.exit(1);
}

