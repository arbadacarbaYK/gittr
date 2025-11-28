# NIP-46 Remote Signer Integration

This document explains how to implement NIP-46 (Remote Signing) in a Nostr client, using the approach we implemented in gittr.space. This enables users to pair hardware signers (like LNbits Remote Nostr Signer, Nowser bunker) without exposing private keys to the browser.

## Overview

**NIP-46** (Nostr Remote Signing) allows a client to request event signing from a remote signer (hardware device, mobile app, or server) via encrypted Nostr events. The client generates an ephemeral keypair, connects to the signer's relays, and requests permission to sign events on behalf of the user.

**Key Benefits:**
- Private keys never leave the hardware signer
- Works with any NIP-46 compatible signer (bunker://, nostrconnect://)
- Exposes a NIP-07-compatible API, so existing code works without changes
- Session persistence for automatic reconnection across page navigations
- **Automatic login**: Users stay logged in after initial pairing—no need to sign in on each page

## Dependencies

Install the required packages:

```bash
npm install html5-qrcode
```

**Note**: We use `html5-qrcode` (version `^2.3.8`) for QR code scanning in the browser. This library provides camera access and QR code decoding capabilities needed for scanning `bunker://` or `nostrconnect://` URIs from hardware signers.

## Event Kinds Used

- **Kind 24133** (NIP-46): Encrypted request/response events between client and remote signer
  - Client publishes requests tagged with remote signer's pubkey
  - Remote signer publishes responses tagged with client's pubkey
  - Content is encrypted using NIP-04 or NIP-44

## Implementation Structure

### 1. Remote Signer Manager Class

```typescript
// ui/src/lib/nostr/remoteSigner.ts

import { type UnsignedEvent, finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from "nostr-tools";
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
  if (input.startsWith("bunker://")) {
    // bunker://<remote-pubkey>?relay=wss://...&secret=...&name=...
    const withoutScheme = input.replace(/^bunker:\/\//i, "");
    const [pubkeyPart, query = ""] = withoutScheme.split("?");
    const params = new URLSearchParams(query);
    const relays = params.getAll("relay").map((relay) => relay.trim()).filter(Boolean);
    return {
      remotePubkey: pubkeyPart.toLowerCase(),
      relays,
      secret: params.get("secret") || undefined,
      label: params.get("name") || params.get("label") || undefined,
    };
  }

  if (input.startsWith("nostrconnect://")) {
    // nostrconnect://<client-pubkey>?relay=wss://...&secret=...&name=...&perms=sign_event:1,nip44_encrypt
    const withoutScheme = input.replace(/^nostrconnect:\/\//i, "");
    const [clientPubkey, query = ""] = withoutScheme.split("?");
    const params = new URLSearchParams(query);
    const relays = params.getAll("relay").map((relay) => relay.trim()).filter(Boolean);
    return {
      remotePubkey: clientPubkey.toLowerCase(),
      relays,
      secret: params.get("secret") || undefined,
      permissions: params.get("perms")?.split(",").map((p) => p.trim()).filter(Boolean),
      label: params.get("name") || undefined,
    };
  }

  throw new Error("Unsupported remote signer URI. Use bunker:// or nostrconnect://");
}
```

### 3. Connection Flow

```typescript
class RemoteSignerManager {
  async connect(uri: string): Promise<{ session: RemoteSignerSession; npub: string }> {
    // 1. Parse URI
    const config = parseRemoteSignerUri(uri);
    
    // 2. Generate ephemeral client keypair
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    
    // 3. Send "connect" request (encrypted Kind 24133 event)
    const connectRequest = {
      id: randomRequestId(),
      method: "connect",
      params: {
        pubkey: clientPubkey,
        secret: config.secret,
      },
    };
    
    await this.sendRequest(config.remotePubkey, connectRequest, config.relays);
    
    // 4. Wait for response with user's pubkey
    const response = await this.waitForResponse(connectRequest.id);
    const userPubkey = response.result.pubkey;
    
    // 5. Create session and persist
    const session: RemoteSignerSession = {
      remotePubkey: config.remotePubkey,
      relays: config.relays,
      clientSecretKey: bytesToHex(clientSecretKey),
      clientPubkey,
      userPubkey,
      secret: config.secret,
      permissions: config.permissions,
      label: config.label,
      lastConnected: Date.now(),
    };
    
    persistRemoteSignerSession(session);
    
    // 6. Apply NIP-07 adapter
    this.applyNip07Adapter();
    
    return { session, npub: nip19.npubEncode(userPubkey) };
  }
}
```

### 4. NIP-07 Compatible Adapter

Override `window.nostr` to route signing through the remote signer:

```typescript
applyNip07Adapter() {
  const originalNostr = window.nostr;
  
  window.nostr = {
    getPublicKey: async () => {
      return this.session?.userPubkey || "";
    },
    
    signEvent: async (event: UnsignedEvent) => {
      if (!this.session) throw new Error("Remote signer not connected");
      
      // Send "sign_event" request
      const request = {
        id: randomRequestId(),
        method: "sign_event",
        params: {
          event: event,
        },
      };
      
      const response = await this.sendRequest(
        this.session.remotePubkey,
        request,
        this.session.relays
      );
      
      return response.result.event; // Signed event from remote signer
    },
    
    nip04: {
      encrypt: async (pubkey: string, plaintext: string) => {
        // Request NIP-04 encryption via remote signer
        const request = {
          id: randomRequestId(),
          method: "nip04_encrypt",
          params: { pubkey, plaintext },
        };
        const response = await this.sendRequest(/* ... */);
        return response.result.ciphertext;
      },
      decrypt: async (pubkey: string, ciphertext: string) => {
        // Request NIP-04 decryption via remote signer
        const request = {
          id: randomRequestId(),
          method: "nip04_decrypt",
          params: { pubkey, ciphertext },
        };
        const response = await this.sendRequest(/* ... */);
        return response.result.plaintext;
      },
    },
    
    nip44: {
      encrypt: async (pubkey: string, plaintext: string) => {
        // Request NIP-44 encryption via remote signer
        const request = {
          id: randomRequestId(),
          method: "nip44_encrypt",
          params: { pubkey, plaintext },
        };
        const response = await this.sendRequest(/* ... */);
        return response.result.ciphertext;
      },
      decrypt: async (pubkey: string, ciphertext: string) => {
        // Request NIP-44 decryption via remote signer
        const request = {
          id: randomRequestId(),
          method: "nip44_decrypt",
          params: { pubkey, ciphertext },
        };
        const response = await this.sendRequest(/* ... */);
        return response.result.plaintext;
      },
    },
  };
  
  // Store original for restoration on disconnect
  this.originalNostr = originalNostr;
}
```

### 5. Encrypted Request/Response

Send encrypted Kind 24133 events:

```typescript
async sendRequest(
  remotePubkey: string,
  request: { id: string; method: string; params: any },
  relays: string[]
): Promise<any> {
  // Encrypt request using NIP-44 (or NIP-04)
  const encrypted = await nip44.encrypt(
    this.session.clientSecretKey,
    remotePubkey,
    JSON.stringify(request)
  );
  
  // Create Kind 24133 event
  const event = finalizeEvent(
    {
      kind: 24133, // NIP-46 request/response kind
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", remotePubkey], // Tag remote signer
      ],
      content: encrypted,
    },
    this.session.clientSecretKey
  );
  
  // Publish to relays
  await this.publish(event, relays);
  
  // Wait for response
  return this.waitForResponse(request.id);
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

### 7. Bootstrap from Storage

On app load, attempt to reconnect. **Important**: For seamless UX, you should also check for stored sessions during auth initialization to immediately set the user as logged in, rather than waiting for async bootstrap.

```typescript
// In your NostrContext or auth provider:

// 1. Check for stored remote signer session during auth initialization
const [authInitialized, setAuthInitialized] = useState(() => {
  if (typeof window === "undefined") return false;
  try {
    // Check for stored pubkey
    const storedPubkey = localStorage.getItem("nostr:npub");
    if (storedPubkey) return true;
    
    // Check for stored remote signer session with userPubkey
    const storedSession = localStorage.getItem("nostr:remote-signer-session");
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed?.userPubkey) return true; // Session exists, user is logged in
      } catch {
        // Invalid JSON, ignore
      }
    }
    
    return false;
  } catch {
    return false;
  }
});

// 2. Set pubkey immediately from stored session (before async bootstrap)
useEffect(() => {
  if (typeof window === "undefined") return;
  
  // Check for stored remote signer session and set pubkey immediately
  try {
    const storedSession = localStorage.getItem("nostr:remote-signer-session");
    if (storedSession) {
      const parsed = JSON.parse(storedSession);
      if (parsed?.userPubkey && !pubkey) {
        // Set pubkey immediately from stored session
        setPubKey(parsed.userPubkey);
      }
    }
  } catch (error) {
    // Ignore errors, will be handled by bootstrap
  }
  
  // Then bootstrap async connection
  remoteSignerRef.current.bootstrapFromStorage();
}, []);

// 3. Remote signer bootstrap (async, restores connection)
bootstrapFromStorage() {
  const stored = loadStoredRemoteSignerSession();
  if (!stored) return;
  
  try {
    console.log("[RemoteSigner] Restoring session from storage");
    await this.activateSession(stored);
    this.notifyState("ready");
  } catch (error: any) {
    console.error("[RemoteSigner] Failed to resume session:", error);
    this.clearSession();
    this.notifyState("error", error?.message || "Failed to resume remote signer session");
  }
}
```

**Why this matters:**
- Without immediate pubkey restoration, users see "Sign in" buttons flash on each page navigation
- By checking localStorage synchronously during initialization, the UI knows the user is logged in immediately
- The async bootstrap then restores the actual connection in the background
- This provides a seamless experience—users stay logged in after initial pairing

## UI Integration

### Login Page

**Important**: After successful pairing, you must call `setAuthor` with the user's `npub` to actually log them in. The pairing alone doesn't log the user in—you need to extract the pubkey from the session and set it as the author.

**Session Persistence**: Once paired, the remote signer session is stored in localStorage. On subsequent page loads, the session is automatically restored and the user remains logged in—no need to pair again or see "Sign in" buttons. The pubkey is set immediately from the stored session, and the connection is restored asynchronously in the background.

```typescript
// ui/src/app/login/page.tsx

import { Html5Qrcode } from "html5-qrcode";
import { nip19 } from "nostr-tools";

const [remoteModalOpen, setRemoteModalOpen] = useState(false);
const [remoteToken, setRemoteToken] = useState("");
const [showQRScanner, setShowQRScanner] = useState(false);
const qrScannerRef = useRef<Html5Qrcode | null>(null);
const qrScanAreaRef = useRef<HTMLDivElement>(null);
const { remoteSigner, setAuthor } = useNostrContext();

// QR Scanner for bunker:// or nostrconnect:// URIs
const startQRScanner = useCallback(async () => {
  if (qrScannerRef.current) return; // Already initialized
  
  setShowQRScanner(true);
  
  // Wait for DOM element to render
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
        stopQRScanner(); // Stop scanner after successful scan
      }
    },
    (errorMessage) => {
      // Ignore scanning errors (user might be adjusting camera)
    }
  );
}, []);

const stopQRScanner = useCallback(async () => {
  if (qrScannerRef.current) {
    try {
      await qrScannerRef.current.stop();
      await qrScannerRef.current.clear();
    } catch (error) {
      // Ignore errors when stopping
    }
    qrScannerRef.current = null;
  }
  setShowQRScanner(false);
}, []);

const handleRemoteConnect = useCallback(async () => {
  if (!remoteSigner || !remoteToken.trim()) return;
  
  setRemoteBusy(true);
  try {
    const result = await remoteSigner.connect(remoteToken.trim());
    // After successful pairing, log the user in with their pubkey
    if (result?.npub && setAuthor) {
      setAuthor(result.npub);
    } else if (remoteSigner?.session?.userPubkey && setAuthor) {
      // Fallback: get pubkey from session and convert to npub
      const npub = nip19.npubEncode(remoteSigner.session.userPubkey);
      setAuthor(npub);
    }
    setRemoteModalOpen(false);
    router.push("/");
  } catch (error: any) {
    setRemoteError(error?.message || "Unable to pair with remote signer");
  } finally {
    setRemoteBusy(false);
  }
}, [remoteSigner, remoteToken, router, setAuthor]);
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

## User Experience: Seamless Login

With the improved session persistence implementation:

1. **Initial Pairing**: User scans QR code and pairs with remote signer once
2. **Automatic Login**: Session is stored in localStorage with `userPubkey`
3. **Page Navigation**: On each page load:
   - `authInitialized` is set to `true` immediately if a stored session exists
   - `pubkey` is set synchronously from the stored session
   - User sees logged-in state immediately (no "Sign in" button flash)
   - Connection is restored asynchronously in the background
4. **No Re-pairing Needed**: Users stay logged in across page navigations, browser refreshes, and even browser restarts (as long as localStorage persists)

**Key Implementation Details:**
- Check for stored remote signer session during `authInitialized` state initialization (synchronous)
- Set `pubkey` immediately from stored session before async bootstrap
- Wait for `authInitialized` in UI components before showing login state
- This prevents the "Sign in" button flash that occurs when waiting for async operations

## Supported Operations

All signing operations automatically use the remote signer:
- Repository pushes (Kind 30617)
- Issue creation (Kind 9803)
- Pull request creation (Kind 9804)
- Profile updates (Kind 0)
- Account settings (Kind 0 with NIP-39)
- SSH key management (Kind 52)
- File/repo deletions (Kind 5, Kind 30617)
- Follows/unfollows (Kind 3)

## References

- **NIP-46**: https://nips.nostr.com/46
- **NIP-07**: https://nips.nostr.com/07
- **NIP-04**: https://nips.nostr.com/04 (Encryption)
- **NIP-44**: https://nips.nostr.com/44 (Encryption v2)
- **Kind 24133**: NIP-46 request/response events

## Example Remote Signers

- **LNbits Remote Nostr Signer**: https://shop.lnbits.com/lnbits-remote-nostr-signer
- **Nowser**: https://github.com/haorendashu/nowser (Mobile bunker)
- **Bunker**: https://github.com/soapbox-pub/bunker (Self-hosted)

## QR Scanning Implementation

We use the **`html5-qrcode`** library (version `^2.3.8`) for QR code scanning. This library:
- Provides browser-based camera access
- Supports both front and back cameras
- Handles QR code decoding automatically
- Works on desktop and mobile browsers (with camera permissions)

**Important Implementation Notes:**
- Always wait for the DOM element to render before initializing `Html5Qrcode`
- Store the scanner instance in a ref to prevent multiple initializations
- Clean up the scanner properly when closing the modal or after a successful scan
- Handle camera permission errors gracefully

**Installation:**
```bash
npm install html5-qrcode
```

**Usage Example:**
```typescript
import { Html5Qrcode } from "html5-qrcode";

const scanner = new Html5Qrcode("qr-scanner-container");
await scanner.start(
  { facingMode: "environment" },
  { fps: 10, qrbox: { width: 250, height: 250 } },
  (decodedText) => {
    // Handle scanned QR code
    if (decodedText.startsWith("bunker://") || decodedText.startsWith("nostrconnect://")) {
      // Process remote signer URI
    }
  }
);
```

