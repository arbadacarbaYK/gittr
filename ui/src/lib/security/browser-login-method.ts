/**
 * How this browser is signed in — same precedence as resolveNostrSigner.
 * Do not treat `window.nostr` as NIP-07: Amber attaches a NIP-07-shaped adapter.
 */

export type BrowserLoginMethod = "remote" | "nip07" | "nsec" | "none";

export type DetectBrowserLoginInput = {
  hasRemoteSession: boolean;
  hasWindowNostr: boolean;
  hasNsecInBrowser: boolean;
};

export type BrowserLoginSnapshot = DetectBrowserLoginInput & {
  method: BrowserLoginMethod;
};

/** Pairing blob from Amber/NIP-46 — not an nsec. Same key as remoteSigner.ts. */
const REMOTE_SIGNER_SESSION_KEY = "nostr:remote-signer-session";

export function hasNsecInBrowserStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!(
      localStorage.getItem("nostr:privkey") ||
      localStorage.getItem("gittr:encrypted:nostr:privkey")
    );
  } catch {
    return false;
  }
}

function hasRemoteSessionInStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(REMOTE_SIGNER_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { userPubkey?: string };
    return (
      typeof parsed?.userPubkey === "string" && parsed.userPubkey.length > 0
    );
  } catch {
    return false;
  }
}

export function readBrowserLoginInput(): DetectBrowserLoginInput {
  if (typeof window === "undefined") {
    return {
      hasRemoteSession: false,
      hasWindowNostr: false,
      hasNsecInBrowser: false,
    };
  }
  return {
    hasRemoteSession: hasRemoteSessionInStorage(),
    hasWindowNostr: typeof window.nostr !== "undefined",
    hasNsecInBrowser: hasNsecInBrowserStorage(),
  };
}

/** Remote session wins even when window.nostr exists (Amber adapter). */
export function detectBrowserLoginMethod(
  input: DetectBrowserLoginInput
): BrowserLoginMethod {
  if (input.hasRemoteSession) return "remote";
  if (input.hasWindowNostr) return "nip07";
  if (input.hasNsecInBrowser) return "nsec";
  return "none";
}

export function readBrowserLoginSnapshot(): BrowserLoginSnapshot {
  const input = readBrowserLoginInput();
  return { ...input, method: detectBrowserLoginMethod(input) };
}

export function signingStatusCopy(snap: BrowserLoginSnapshot): {
  title: string;
  body: string;
} {
  switch (snap.method) {
    case "remote":
      return {
        title: "Signed in with a remote signer",
        body: "Amber / NIP-46 (or another bunker) holds your identity key. gittr only stores a pairing session in this browser — not your nsec. Approvals pop on the phone when you push or publish.",
      };
    case "nip07":
      return {
        title: "Signed in with a browser extension",
        body: "NIP-07 (Alby, nos2x, …) keeps your key in the extension. gittr never stores that nsec in localStorage.",
      };
    case "nsec":
      return {
        title: "Signed in with an nsec in this browser",
        body: "Your private key is stored here. That is the weaker option — prefer a phone signer (Amber) or a NIP-07 extension. If you keep the nsec, encrypt it below.",
      };
    default:
      return {
        title: "No signing key in this browser",
        body: "You can browse without one. To push or publish, pair a remote signer (Amber) or a NIP-07 extension — both keep the key off localStorage.",
      };
  }
}

export function leftoverNsecCopy(method: BrowserLoginMethod): {
  title: string;
  body: string;
  tip: string;
} {
  const notHowYouSign =
    method === "remote"
      ? "You are signing with a remote signer, but this browser still has an nsec sitting in localStorage. That leftover key is not how you log in — encrypt it or remove it."
      : method === "nip07"
      ? "You are signing with a browser extension, but this browser still has an nsec in localStorage. Encrypt it or remove it so it cannot be copied from this machine."
      : "Your Nostr private key is stored as plaintext in this browser’s localStorage. Anyone with access to this profile can copy it.";
  return {
    title: "nsec stored in this browser",
    body: notHowYouSign,
    tip: "Safer: pair Amber (NIP-46) or a NIP-07 extension so the identity key never lives here. Encryption is a fallback if you must keep an nsec in the browser.",
  };
}

export function encryptionOptionalCopy(method: BrowserLoginMethod): string {
  if (method === "remote" || method === "nip07") {
    return "Signing does not use a private key in this browser, so you do not need encryption for login. Turn it on only if you stored Lightning / NWC secrets under Settings → Account.";
  }
  return "Set a password to encrypt a stored nsec (and Account payment secrets). You enter it once per browser session.";
}

export function aboutEncryptionItems(snap: BrowserLoginSnapshot): string[] {
  if (snap.method === "remote" || snap.method === "nip07") {
    if (!snap.hasNsecInBrowser) {
      return [
        "This password does not protect your Amber or extension key — those never enter gittr.",
        "It only wraps secrets this site stored locally (optional nsec, Account Lightning / NWC keys).",
        "Skip it if you have no nsec and no payment secrets in this browser.",
      ];
    }
  }
  return [
    "AES-256-GCM with PBKDF2. The password is never stored — only a hash to check it.",
    "Encrypted blobs live in this browser’s localStorage.",
    "You enter the password once per session; it stays in memory until the tab/browser closes.",
  ];
}

export function bestPracticeItems(method: BrowserLoginMethod): string[] {
  if (method === "remote") {
    return [
      "Keep Amber (or your bunker app) unlocked when you push or publish so the phone can approve the signature.",
      "The pairing session in localStorage is not your nsec, but still clear site data on a shared computer.",
      "Never share nsec, bunker secrets, or an encryption password.",
      "Only install browser extensions you trust — they can read localStorage.",
    ];
  }
  if (method === "nip07") {
    return [
      "Keep using the extension — the key stays there, not in gittr localStorage.",
      "Lock or pin the extension; don’t leave it unlocked on a shared computer.",
      "Clear site data on shared machines; never share keys or an encryption password.",
      "Only install browser extensions you trust.",
    ];
  }
  return [
    "Prefer Amber (NIP-46) or a NIP-07 extension so the identity key never sits in localStorage.",
    "Enable encryption if you must keep an nsec in this browser.",
    "Clear localStorage after using a shared computer.",
    "Never share your encryption password or private keys.",
    "Use a strong password (12+ mixed characters) if you enable encryption.",
    "Only install browser extensions you trust — they can read localStorage.",
  ];
}

export function whatGetsEncryptedItems(snap: BrowserLoginSnapshot): {
  items: string[];
  note: string;
} {
  if (
    (snap.method === "remote" || snap.method === "nip07") &&
    !snap.hasNsecInBrowser
  ) {
    return {
      items: [
        "Not your identity key — Amber / the extension holds that.",
        "Optional: Lightning / NWC secrets if you saved them on Settings → Account and turned encryption on.",
      ],
      note: "Public keys, repository listings, and ordinary settings stay unencrypted (they are not the signing key).",
    };
  }
  return {
    items: [
      "Nostr private key (nsec) stored in this browser — the important one.",
      "Account payment secrets (NWC / LNbits keys) when encryption is on.",
    ],
    note: "Public keys, repository data, and settings stay unencrypted (they are not sensitive the same way).",
  };
}
