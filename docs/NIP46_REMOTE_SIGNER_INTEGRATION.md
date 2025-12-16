# NIP-46 Remote Signer Integration

Complete implementation guide for NIP-46 (Remote Signing) in Nostr clients, enabling hardware signers (LNbits, Nowser bunker, Amber bunker) without exposing private keys to the browser.

## Overview

**NIP-46** (Nostr Remote Signing) allows a client to request event signing from a remote signer (hardware device, mobile app, or server) via encrypted Nostr events. The client generates an ephemeral keypair, connects to the signer's relays, and requests permission to sign events on behalf of the user.

**Key Benefits:**
- Private keys never leave the hardware signer
- Works with any NIP-46 compatible signer (bunker://, nostrconnect://)
- Exposes a NIP-07-compatible API, so existing code works without changes
- Session persistence for automatic reconnection across page navigations
- Automatic login: Users stay logged in after initial pairing

## Dependencies

```bash
npm install html5-qrcode
```

We use `html5-qrcode` (version `^2.3.8`) for QR code scanning in the browser.

## Event Kinds Used

- **Kind 24133** (NIP-46): Encrypted request/response events between client and remote signer
  - Client publishes requests tagged with remote signer's pubkey
  - Remote signer publishes responses tagged with client's pubkey
  - Content is encrypted using NIP-04 or NIP-44

## Implementation

### 1. Remote Signer Manager

```typescript
// ui/src/lib/nostr/remoteSigner.ts

import { type UnsignedEvent, generatePrivateKey, getPublicKey, getEventHash, signEvent, nip19, nip04 } from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";

export interface RemoteSignerConfig {
  remotePubkey: string;  // Remote signer's pubkey (from bunker:// or nostrconnect:// URI)
  relays: string[];      // Relays the remote signer uses
  secret?: string;        // Optional shared secret for authentication
  permissions?: string[]; // Requested permissions (e.g., ["sign_event", "nip44_encrypt"])
  label?: string;        // Optional label for the connection
}

export interface RemoteSignerSession {
  remotePubkey: string;
  relays: string[];
  clientSecretKey: string;  // Ephemeral client secret key
  clientPubkey: string;     // Ephemeral client pubkey
  userPubkey: string;        // User's pubkey (from remote signer)
  secret?: string;
  permissions?: string[];
  label?: string;
  lastConnected: number;
}

export type RemoteSignerState = "idle" | "connecting" | "ready" | "error";
```

### 2. URI Parsing

Parse `bunker://` or `nostrconnect://` URIs:

```typescript
export function parseRemoteSignerUri(input: string): RemoteSignerConfig {
  if (!input || typeof input !== "string") {
    throw new Error("Remote signer token required");
  }
  const trimmed = input.trim();
  
  if (trimmed.startsWith("bunker://")) {
    const withoutScheme = trimmed.replace(/^bunker:\/\//i, "");
    const [pubkeyPart, query = ""] = withoutScheme.split("?");
    if (!pubkeyPart || pubkeyPart.length !== 64) {
      throw new Error("Invalid bunker token: missing remote signer pubkey");
    }
    const params = new URLSearchParams(query);
    const relays = params.getAll("relay").map((relay) => relay.trim()).filter(Boolean);
    if (relays.length === 0) {
      throw new Error("Remote signer token missing relay query param");
    }
    const secret = params.get("secret") || undefined;
    const label = params.get("name") || params.get("label") || undefined;
    return {
      remotePubkey: pubkeyPart.toLowerCase(),
      relays,
      secret,
      label,
    };
  }

  if (trimmed.startsWith("nostrconnect://")) {
    const withoutScheme = trimmed.replace(/^nostrconnect:\/\//i, "");
    const [clientPubkey, query = ""] = withoutScheme.split("?");
    if (!clientPubkey || clientPubkey.length !== 64) {
      throw new Error("Invalid nostrconnect URI: missing client pubkey");
    }
    const params = new URLSearchParams(query);
    const relays = params.getAll("relay").map((relay) => relay.trim()).filter(Boolean);
    if (relays.length === 0) {
      throw new Error("nostrconnect URI missing relay");
    }
    const secret = params.get("secret") || undefined;
    const permissions = params.get("perms")?.split(",").map((p) => p.trim()).filter(Boolean);
    const label = params.get("name") || params.get("label") || undefined;
    return {
      remotePubkey: clientPubkey.toLowerCase(),
      relays,
      secret,
      permissions,
      label,
    };
  }

  throw new Error("Unsupported remote signer URI. Use bunker:// or nostrconnect://");
}
```

### 3. Connection Flow

```typescript
class RemoteSignerManager {
  async connect(uri: string): Promise<{ session: RemoteSignerSession; npub: string }> {
    const config = parseRemoteSignerUri(uri);
    this.notifyState("connecting");

    // Generate ephemeral client keypair
    // CRITICAL: generatePrivateKey() returns a hex string directly, no conversion needed
    const generatedClientSecret = generatePrivateKey();
    const session: RemoteSignerSession = {
      remotePubkey: config.remotePubkey,
      relays: config.relays,
      clientSecretKey: generatedClientSecret, // generatePrivateKey returns hex string
      clientPubkey: "",
      userPubkey: "",
      secret: config.secret,
      permissions: config.permissions,
      label: config.label,
      lastConnected: Date.now(),
    };
    session.clientPubkey = getPublicKey(session.clientSecretKey);
    
    try {
      await this.ensureRelays(session.relays);
      await this.startSubscription(session);

      const connectParams = [session.remotePubkey];
      if (session.secret) {
        connectParams.push(session.secret);
      }
      if (session.permissions && session.permissions.length > 0) {
        connectParams.push(session.permissions.join(","));
      }
      await this.sendRequest(session, "connect", connectParams, 20000);

      const remotePubkeyHex = await this.sendRequest(session, "get_public_key", []);
      if (!remotePubkeyHex || typeof remotePubkeyHex !== "string") {
        throw new Error("Remote signer did not return a pubkey");
      }
      session.userPubkey = remotePubkeyHex.toLowerCase();
      session.lastConnected = Date.now();

      await this.activateSession(session);
      this.notifyState("ready");

      return {
        session,
        npub: nip19.npubEncode(session.userPubkey),
      };
    } catch (error: any) {
      console.error("[RemoteSigner] Pairing failed:", error);
      this.clearSession();
      this.notifyState("error", error?.message || "Remote signer pairing failed");
      throw error;
    }
  }
}
```

### 4. NIP-07 Compatible Adapter

Override `window.nostr` to route signing through the remote signer. The adapter includes complete NIP-07 support:

```typescript
private applyNip07Adapter() {
  if (typeof window === "undefined") return;
  // Always capture the current window.nostr before applying the adapter
  // This ensures that if a NIP-07 extension loads asynchronously, its reference is preserved.
  if (!this.originalNostr) {
    this.originalNostr = window.nostr;
  }
  const adapter = createRemoteNip07Adapter(this);
  this.adapter = adapter;
  window.nostr = adapter;
}

function createRemoteNip07Adapter(manager: RemoteSignerManager) {
  return {
    getPublicKey: async () => {
      const pubkey = manager.getUserPubkey();
      if (!pubkey) {
        throw new Error("Remote signer not paired");
      }
      return pubkey;
    },
    
    signEvent: (event: UnsignedEvent) => manager.signEvent(event),
    
    getRelays: async () => {
      const session = manager.getSession();
      if (!session) return {};
      return session.relays.reduce<Record<string, { read: boolean; write: boolean }>>((acc, relay) => {
        acc[relay] = { read: true, write: true };
        return acc;
      }, {});
    },
    
    nip04: {
      encrypt: (pubkey: string, plaintext: string) => manager.nip04Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) => manager.nip04Decrypt(pubkey, ciphertext),
    },
    
    nip44: {
      encrypt: (pubkey: string, plaintext: string) => manager.nip44Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) => manager.nip44Decrypt(pubkey, ciphertext),
    },
  };
}
```

### 5. Encrypted Request/Response

Send encrypted Kind 24133 events:

```typescript
private async sendRequest(
  session: RemoteSignerSession,
  method: string,
  params: unknown[],
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<any> {
  await this.ensureRelays(session.relays);
  const id = randomRequestId();
  const payload = JSON.stringify({
    id,
    method,
    params,
  });
  // CRITICAL: nip04.encrypt accepts hex secret key directly (nostr-tools handles hex strings)
  const ciphertext = await nip04.encrypt(session.clientSecretKey, session.remotePubkey, payload);
  const unsignedEvent: any = {
    kind: 24133, // NIP-46 request/response kind
    created_at: Math.floor(Date.now() / 1000),
    content: ciphertext,
    tags: [
      ["p", session.remotePubkey], // Tag remote signer
    ],
    pubkey: getPublicKey(session.clientSecretKey),
  };
  unsignedEvent.id = getEventHash(unsignedEvent);
  const signed = signEvent(unsignedEvent, session.clientSecretKey);
  this.deps.publish(signed, session.relays);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`Remote signer request ${method} timed out`));
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timeout });
  });
}
```

### 6. Session Persistence

Store session in localStorage for reconnection:

```typescript
const STORAGE_KEY = "nostr:remote-signer-session";

export function persistRemoteSignerSession(session: RemoteSignerSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  } catch (error) {
    console.error("[RemoteSigner] Failed to persist session:", error);
  }
}

export function loadStoredRemoteSignerSession(): RemoteSignerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteSignerSession;
    if (!parsed.remotePubkey || !parsed.clientSecretKey || !parsed.userPubkey) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[RemoteSigner] Failed to load stored session:", error);
    return null;
  }
}
```

### 7. Bootstrap from Storage (Automatic Login)

On app load, restore session synchronously to prevent UI flickering:

```typescript
// In NostrContext.tsx

const getInitialPubkey = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    // Check regular localStorage pubkey first
    const storedPubkey = window.localStorage.getItem(WEB_STORAGE_KEYS.NPUB);
    if (storedPubkey) {
      try {
        return JSON.parse(storedPubkey) as string;
      } catch {
        // Invalid JSON, continue to check remote signer
      }
    }
    // Check remote signer session
    const storedSession = loadStoredRemoteSignerSession();
    if (storedSession?.userPubkey) {
      return storedSession.userPubkey;
    }
  } catch (error) {
    // Ignore errors during initialization
  }
  return null;
};

const [pubkey, setPubKey, removePubKey] = useLocalStorage<string | null>(
  WEB_STORAGE_KEYS.NPUB,
  getInitialPubkey()
);

// Bootstrap async connection (restores window.nostr adapter)
useEffect(() => {
  if (!remoteSignerInitialized || !remoteSignerRef.current) return;
  remoteSignerRef.current.bootstrapFromStorage().catch((error) => {
    console.error("[NostrContext] Failed to bootstrap remote signer:", error);
  });
}, [remoteSignerInitialized]);
```

**Why this matters:**
- Without immediate pubkey restoration, users see "Sign in" buttons flash on each page navigation
- By checking localStorage synchronously during initialization, the UI knows the user is logged in immediately
- The async bootstrap then restores the actual connection in the background
- This provides a seamless experience—users stay logged in after initial pairing

## UI Integration

### Login Page

After successful pairing, call `setAuthor` with the user's `npub` to log them in:

```typescript
// ui/src/app/login/page.tsx

import { Html5Qrcode } from "html5-qrcode";
import { nip19 } from "nostr-tools";

const { remoteSigner, setAuthor } = useNostrContext();

const handleRemoteConnect = useCallback(async () => {
  if (!remoteSigner) {
    setRemoteError("Remote signer manager not ready yet. Please try again in a moment.");
    return;
  }
  if (!remoteToken.trim()) {
    setRemoteError("Paste a bunker:// or nostrconnect:// token.");
    return;
  }
  setRemoteBusy(true);
  setRemoteError(null);
  try {
    const result = await remoteSigner.connect(remoteToken.trim());
    if (result?.npub && setAuthor) {
      setAuthor(result.npub);
    } else if (remoteSigner?.getSession()?.userPubkey && setAuthor) {
      const npub = nip19.npubEncode(remoteSigner.getSession().userPubkey);
      setAuthor(npub);
    }
    setRemoteBusy(false);
    setRemoteModalOpen(false);
    setRemoteToken("");
    router.push("/");
  } catch (error: any) {
    console.error("[Login] Remote signer pairing failed:", error);
    setRemoteBusy(false);
    setRemoteError(error?.message || "Unable to pair with remote signer");
  }
}, [remoteSigner, remoteToken, router, setAuthor]);
```

### QR Scanner

```typescript
const startQRScanner = useCallback(async () => {
  if (qrScannerRef.current) return;
  
  setShowQRScanner(true);
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const scanner = new Html5Qrcode("qr-scanner-container");
  qrScannerRef.current = scanner;
  
  await scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      if (decodedText.startsWith("bunker://") || decodedText.startsWith("nostrconnect://")) {
        setRemoteToken(decodedText);
        setRemoteError(null);
        stopQRScanner();
      }
    },
    (errorMessage) => {
      // Ignore scanning errors
    }
  );
}, []);
```

## Usage in Existing Code

Once the NIP-07 adapter is applied, all existing code that uses `window.nostr.signEvent()` automatically works with the remote signer:

```typescript
// This works without any changes!
const hasNip07 = typeof window !== "undefined" && window.nostr;
if (hasNip07 && window.nostr) {
  const signedEvent = await window.nostr.signEvent(unsignedEvent);
  await publish(signedEvent);
}
```

## Supported Operations

All signing operations automatically use the remote signer:
- Repository pushes (Kind 30617)
- Issue creation (Kind 1621)
- Pull request creation (Kind 1618)
- Profile updates (Kind 0)
- Account settings (Kind 0 with NIP-39)
- SSH key management (Kind 52)
- File/repo deletions (Kind 5, Kind 30617)
- Follows/unfollows (Kind 3)

## Critical Implementation Notes

1. **`generatePrivateKey()` returns hex string directly** - no `bytesToHex` conversion needed
2. **`nip04.encrypt()` and `nip04.decrypt()` accept hex secret keys directly** - nostr-tools handles hex strings
3. **Always use `generatePrivateKey()`** (not `generateSecretKey()`) from nostr-tools
4. **The NIP-07 adapter includes `getRelays()` and `nip44` support** for complete compatibility
5. **Preserve original `window.nostr`** - capture it before applying adapter, restore on disconnect
6. **Synchronous pubkey restoration** - check localStorage during initialization to prevent UI flickering

## References

- **NIP-46**: https://nips.nostr.com/46
- **NIP-07**: https://nips.nostr.com/07
- **NIP-04**: https://nips.nostr.com/04 (Encryption)
- **NIP-44**: https://nips.nostr.com/44 (Encryption v2)
- **Kind 24133**: NIP-46 request/response events

## Example Remote Signers

- **LNbits Remote Nostr Signer**: https://shop.lnbits.com/lnbits-remote-nostr-signer
- **Nowser Bunker**: https://github.com/haorendashu/nowser (Mobile bunker)
- **Amber Bunker**: Compatible with NIP-46 standard
- **Bunker**: https://github.com/soapbox-pub/bunker (Self-hosted)

## Compatibility

This implementation is compatible with all NIP-46 compliant remote signers, including:
- Hardware signers (LNbits, BoltCard)
- Mobile apps (Nowser Bunker)
- Self-hosted servers (Bunker)
- Any signer using `bunker://` or `nostrconnect://` URI format
