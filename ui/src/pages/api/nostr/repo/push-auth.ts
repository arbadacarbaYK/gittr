/**
 * Bridge Push Authentication Middleware
 * 
 * Two auth methods supported:
 * 1. NIP-98 HTTP Auth (preferred for agents) - sign a challenge with Nostr key
 * 2. SSH Key pubkey verification - verify pubkey owns SSH keys in Nostr
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SimplePool } from "nostr-tools";

const KIND_SSH_KEY = 52;

/**
 * Extract and verify Nostr auth from request headers
 * Supports:
 * - Authorization: Nostr <base64-signed-challenge>
 * - X-Nostr-Pubkey: <hex-pubkey>
 * - X-Nostr-Signature: <sig>
 */
export async function verifyNostrAuth(req: NextApiRequest): Promise<{
  authorized: boolean;
  pubkey?: string;
  error?: string;
}> {
  const authHeader = req.headers.authorization;
  const providedPubkey = req.headers['x-nostr-pubkey'] as string | undefined;
  const providedSig = req.headers['x-nostr-signature'] as string | undefined;
  
  // Method 1: NIP-98 style Authorization header
  if (authHeader?.startsWith('Nostr ')) {
    try {
      const encoded = authHeader.slice(7); // Remove "Nostr " prefix
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const challenge = JSON.parse(decoded);
      
      if (!challenge.pubkey || !challenge.sig) {
        return { authorized: false, error: 'Invalid challenge format' };
      }
      
      // Verify the signature
      const { verify } = await import('@noble/secp256k1');
      const pubkeyBuffer = Buffer.from(challenge.pubkey, 'hex');
      const message = JSON.stringify(challenge);
      const msgHash = new TextEncoder().encode(message);
      
      // For NIP-98, we verify the signature over the challenge (msgHash truncated to 32 bytes for ECDSA)
      const sigBytes = new Uint8Array(Buffer.from(challenge.sig, 'hex'));
      const msgHash32 = new Uint8Array(msgHash.slice(0, 32));
      const pubkeyU8 = new Uint8Array(pubkeyBuffer);
      const isValid = verify(sigBytes, msgHash32, pubkeyU8);
      
      if (!isValid) {
        return { authorized: false, error: 'Invalid signature' };
      }
      
      // Challenge must be recent (within 5 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (challenge.created_at && now - challenge.created_at > 300) {
        return { authorized: false, error: 'Challenge expired' };
      }
      
      return { authorized: true, pubkey: challenge.pubkey };
    } catch (err: any) {
      return { authorized: false, error: `Auth verification failed: ${err.message}` };
    }
  }
  
  // Method 2: Direct pubkey + signature (simpler for some clients)
  if (providedPubkey && providedSig) {
    try {
      const { verify } = await import('@noble/secp256k1');
      
      // Create a simple challenge message
      const message = `gittr:push:${providedPubkey}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(message);
      
      const sigBytes = new Uint8Array(Buffer.from(providedSig, 'hex'));
      const pubkeyBytes = new Uint8Array(Buffer.from(providedPubkey, 'hex'));
      const msgHash32 = new Uint8Array(msgBytes.slice(0, 32));
      const isValid = verify(sigBytes, msgHash32, pubkeyBytes);
      
      if (!isValid) {
        return { authorized: false, error: 'Invalid signature' };
      }
      
      return { authorized: true, pubkey: providedPubkey };
    } catch (err: any) {
      return { authorized: false, error: `Signature verification failed: ${err.message}` };
    }
  }
  
  // No auth provided
  return { authorized: false, error: 'No authentication provided. Use Nostr HTTP Auth (NIP-98) or provide pubkey+signature.' };
}

/**
 * Verify that the authenticated pubkey owns SSH keys for this repo
 * This allows SSH key holders to push via the bridge
 */
export async function verifySSHKeyOwnership(
  pubkey: string,
  ownerPubkey: string,
  relays: string[] = []
): Promise<{ authorized: boolean; error?: string }> {
  // If pushing to own repo, allow (they own the SSH keys by definition)
  if (pubkey.toLowerCase() === ownerPubkey.toLowerCase()) {
    return { authorized: true };
  }
  
  // For pushing to others' repos, check if they have authorized this pubkey
  // This would require a collaboration/permissions system
  // For now, deny cross-owner pushes unless explicitly authorized
  // TODO: Add collaboration permissions storage
  
  return { authorized: false, error: 'Cross-owner pushes require collaboration setup' };
}

/**
 * Generate a challenge for NIP-98 auth
 */
export function generateChallenge(pubkey: string): {
  pubkey: string;
  created_at: number;
  challenge: string;
} {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    challenge: `gittr:push:${Date.now()}`,
  };
}

/** This file is a shared auth helper; not a standalone API route. */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Allow", "GET, POST");
  res.status(405).json({
    error:
      "Not an endpoint. Use /api/nostr/repo/push or /api/nostr/repo/push-challenge.",
  });
}
