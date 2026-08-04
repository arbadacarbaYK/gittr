import { randomBytes } from "crypto";

/** In-memory push-auth challenges (multi-use within TTL for chunked pushes). */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10_000;

const issued = new Map<string, number>(); // challenge -> expiresAt ms

function prune(): void {
  const now = Date.now();
  for (const [k, exp] of issued) {
    if (exp <= now) issued.delete(k);
  }
  // Hard cap: drop oldest if somehow huge
  if (issued.size > MAX_ENTRIES) {
    const sorted = [...issued.entries()].sort((a, b) => a[1] - b[1]);
    const overflow = sorted.length - MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      const entry = sorted[i];
      if (entry) issued.delete(entry[0]);
    }
  }
}

export function issuePushChallenge(): string {
  prune();
  const challenge = `gittr:push:${Date.now()}:${randomBytes(16).toString("hex")}`;
  issued.set(challenge, Date.now() + CHALLENGE_TTL_MS);
  return challenge;
}

export function isValidIssuedPushChallenge(challenge: string): boolean {
  if (!challenge || typeof challenge !== "string") return false;
  const exp = issued.get(challenge);
  if (!exp) return false;
  if (Date.now() > exp) {
    issued.delete(challenge);
    return false;
  }
  return true;
}

export function pushChallengeTtlSeconds(): number {
  return Math.floor(CHALLENGE_TTL_MS / 1000);
}
