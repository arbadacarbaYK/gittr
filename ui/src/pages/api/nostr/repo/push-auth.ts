/**
 * Bridge Push Authentication Middleware
 *
 * Preferred: X-Nostr-Auth-Event with kind 24242 bound to a server-issued challenge
 * (from /api/nostr/repo/push-challenge). Kind 30617 allowed only when its `d` tag
 * matches the target repo (same-session Push to Nostr UX).
 */
import {
  isValidIssuedPushChallenge,
  pushChallengeTtlSeconds,
} from "@/lib/nostr/push-challenge-store";

import type { NextApiRequest, NextApiResponse } from "next";

const KIND_REPOSITORY_ANNOUNCEMENT = 30617;
const KIND_HTTP_AUTH = 24242;
const AUTH_EVENT_MAX_AGE_SECONDS = 10 * 60;

export type VerifyNostrAuthOptions = {
  /** When set, kind 30617 must carry a matching `d` tag (repo slug). */
  expectedRepo?: string;
};

function eventTagValue(event: any, name: string): string | undefined {
  if (!Array.isArray(event?.tags)) return undefined;
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      return tag[1];
    }
  }
  return undefined;
}

/**
 * Extract and verify Nostr auth from request headers
 */
export async function verifyNostrAuth(
  req: NextApiRequest,
  options: VerifyNostrAuthOptions = {}
): Promise<{
  authorized: boolean;
  pubkey?: string;
  error?: string;
}> {
  const authHeader = req.headers.authorization;
  const signedAuthEventHeader = req.headers["x-nostr-auth-event"] as
    | string
    | undefined;

  // Method 0: Signed Nostr event (kind 24242 challenge or bound 30617)
  if (signedAuthEventHeader) {
    try {
      const decoded = Buffer.from(signedAuthEventHeader, "base64").toString(
        "utf-8"
      );
      const parsedEvent = JSON.parse(decoded);
      const { validateEvent, verifySignature } = await import("nostr-tools");

      if (!validateEvent(parsedEvent)) {
        return { authorized: false, error: "Invalid auth event format" };
      }

      if (!verifySignature(parsedEvent)) {
        return { authorized: false, error: "Invalid auth event signature" };
      }

      if (
        parsedEvent.kind !== KIND_REPOSITORY_ANNOUNCEMENT &&
        parsedEvent.kind !== KIND_HTTP_AUTH
      ) {
        return {
          authorized: false,
          error:
            "Auth event must be a repository announcement (kind 30617) or signed auth challenge (kind 24242)",
        };
      }

      const now = Math.floor(Date.now() / 1000);
      if (
        typeof parsedEvent.created_at !== "number" ||
        Math.abs(now - parsedEvent.created_at) > AUTH_EVENT_MAX_AGE_SECONDS
      ) {
        return { authorized: false, error: "Auth event expired" };
      }

      if (!parsedEvent.pubkey || typeof parsedEvent.pubkey !== "string") {
        return { authorized: false, error: "Auth event missing pubkey" };
      }

      if (parsedEvent.kind === KIND_HTTP_AUTH) {
        const challenge = eventTagValue(parsedEvent, "challenge");
        if (!challenge || !isValidIssuedPushChallenge(challenge)) {
          return {
            authorized: false,
            error: `Auth challenge missing or expired (fetch /api/nostr/repo/push-challenge, TTL ${pushChallengeTtlSeconds()}s)`,
          };
        }
      } else if (parsedEvent.kind === KIND_REPOSITORY_ANNOUNCEMENT) {
        const expected = options.expectedRepo?.trim();
        if (expected) {
          const d = eventTagValue(parsedEvent, "d");
          if (!d || d !== expected) {
            return {
              authorized: false,
              error:
                "Repository announcement auth must match the target repo (d tag)",
            };
          }
        } else {
          // Without a repo binding, 30617 is too powerful as a bearer token.
          return {
            authorized: false,
            error:
              "Use a signed kind-24242 challenge auth event (X-Nostr-Auth-Event)",
          };
        }
      }

      return { authorized: true, pubkey: parsedEvent.pubkey.toLowerCase() };
    } catch (err: any) {
      return {
        authorized: false,
        error: `Auth event verification failed: ${err.message}`,
      };
    }
  }

  // Method 1: Legacy Authorization: Nostr <base64({pubkey,sig,created_at})>
  // Accept only when paired with a valid X-Nostr-Auth-Event above. Alone it is
  // not challenge-bound and must not authorize.
  if (authHeader?.startsWith("Nostr ")) {
    return {
      authorized: false,
      error:
        "Authorization: Nostr alone is not sufficient. Send X-Nostr-Auth-Event with a kind-24242 event that includes the server challenge tag.",
    };
  }

  return {
    authorized: false,
    error:
      "No authentication provided. Sign a push-challenge (kind 24242) and send X-Nostr-Auth-Event.",
  };
}

/**
 * Verify that the authenticated pubkey owns this repo (or is the owner).
 */
export async function verifySSHKeyOwnership(
  pubkey: string,
  ownerPubkey: string,
  _relays: string[] = []
): Promise<{ authorized: boolean; error?: string }> {
  if (pubkey.toLowerCase() === ownerPubkey.toLowerCase()) {
    return { authorized: true };
  }

  return {
    authorized: false,
    error: "Cross-owner pushes require collaboration setup",
  };
}

/**
 * Generate a challenge payload (clients should prefer /push-challenge).
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

/** Not an HTTP API — helpers only. Keeps Next.js route typing happy. */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(404).json({
    error: "Not found",
    hint: "Import verifyNostrAuth from this module; use /api/nostr/repo/push-challenge for challenges.",
  });
}
