// NWC connection test - simpler than balance check
// Just verifies we can connect to relay and send a request
// Doesn't require get_balance method support
//
// ⚠️ PRIVACY & SECURITY: This is 100% CLIENT-SIDE ONLY
// - Secret key NEVER leaves the browser
// - WebSocket connects DIRECTLY to the Nostr relay (not through our server)
// - All encryption/decryption happens in the browser using Web Crypto API
// - No data is sent to our server - everything goes directly to the relay
// - The secret key is only used locally for signing/encrypting events
import { getEventHash, getPublicKey, nip04, signEvent } from "nostr-tools";

import { parseNwcConnectionUri } from "./nwc-uri";

export interface NWCConnectionResult {
  connected: boolean;
  relayReachable: boolean;
  requestAccepted: boolean;
  error?: string;
  /** Which URI relay succeeded (when multiple relay= are present) */
  relayUsed?: string;
}

/**
 * Test NWC connection by:
 * 1. Connecting to each relay from the URI (Alby often lists two)
 * 2. Sending a simple request (get_info or get_balance)
 * 3. Verifying we get an OK response (even if method not supported)
 */
export async function testNWCConnection(
  nwcUri: string
): Promise<NWCConnectionResult> {
  const parsed = parseNwcConnectionUri(nwcUri);
  const sk = parsed.secret;
  const clientPubkey = getPublicKey(sk);

  console.log(
    "NWC Connection Test: Trying relays from URI:",
    parsed.relays.join(", ")
  );
  console.log("NWC Connection Test: Wallet pubkey:", parsed.walletPubkey);

  const methodsToTry = ["get_info", "get_balance"];
  let lastError: string | undefined;

  for (const relay of parsed.relays) {
    for (const method of methodsToTry) {
      try {
        const result = await testNWCMethod(
          relay,
          parsed.walletPubkey,
          sk,
          clientPubkey,
          method
        );
        if (result.connected) {
          return { ...result, relayUsed: relay };
        }
      } catch (error: any) {
        lastError = error?.message || String(error);
        console.log(
          `NWC Connection Test: ${method} on ${relay} failed:`,
          lastError
        );
      }
    }
  }

  // Last resort: any relay reachable at all?
  for (const relay of parsed.relays) {
    const reach = await testRelayConnectivity(relay);
    if (reach.relayReachable) {
      return {
        ...reach,
        relayUsed: relay,
        error:
          reach.error ||
          lastError ||
          "Relay reachable but wallet methods did not respond",
      };
    }
  }

  return {
    connected: false,
    relayReachable: false,
    requestAccepted: false,
    error:
      lastError ||
      `Cannot connect to any URI relay: ${parsed.relays.join(", ")}`,
  };
}

async function testNWCMethod(
  relay: string,
  walletPubkey: string,
  sk: string,
  clientPubkey: string,
  method: string
): Promise<NWCConnectionResult> {
  return new Promise<NWCConnectionResult>((resolve, reject) => {
    const ws = new WebSocket(relay);
    const requestTimestamp = Math.floor(Date.now() / 1000);
    const subId = `nwc-test-${Date.now()}`;
    let relayConnected = false;
    let requestAccepted = false;
    let requestSent = false;

    const timeout = setTimeout(() => {
      ws.close();
      if (!relayConnected) {
        reject(new Error(`Failed to connect to relay: ${relay}`));
      } else if (!requestSent) {
        reject(new Error(`Failed to send request to relay`));
      } else if (!requestAccepted) {
        // Request was sent but no OK response - might be method not supported, but connection works
        resolve({
          connected: true,
          relayReachable: true,
          requestAccepted: false,
          error: `Connection works but ${method} method may not be supported`,
        });
      } else {
        resolve({
          connected: true,
          relayReachable: true,
          requestAccepted: true,
        });
      }
    }, 10000); // 10 second timeout

    ws.onopen = () => {
      console.log("NWC Connection Test: Connected to relay");
      relayConnected = true;

      // Subscribe to response events (we might not get one, but that's OK)
      const subscription = [
        "REQ",
        subId,
        {
          kinds: [23195], // NIP-47 response events
          authors: [walletPubkey],
          since: requestTimestamp,
        },
      ];

      ws.send(JSON.stringify(subscription));

      // Create request
      const requestPayload = {
        method: method,
        params: {},
      };

      // Encrypt and send request
      (async () => {
        try {
          const encryptedContent = await nip04.encrypt(
            sk,
            walletPubkey,
            JSON.stringify(requestPayload)
          );

          const requestEvent: any = {
            kind: 23194,
            content: encryptedContent,
            tags: [["p", walletPubkey]],
            created_at: Math.floor(Date.now() / 1000),
            pubkey: clientPubkey,
          };

          requestEvent.id = getEventHash(requestEvent);
          requestEvent.sig = signEvent(requestEvent, sk);

          // Wait a bit then send request
          setTimeout(() => {
            console.log(`NWC Connection Test: Sending ${method} request`);
            ws.send(JSON.stringify(["EVENT", requestEvent]));
            requestSent = true;
          }, 500);
        } catch (error: any) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Failed to encrypt request: ${error.message}`));
        }
      })();
    };

    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data);

        // Handle OK response - this means the relay accepted our request
        if (Array.isArray(data) && data[0] === "OK") {
          console.log("NWC Connection Test: Received OK response from relay");
          requestAccepted = true;
          clearTimeout(timeout);
          ws.close();
          resolve({
            connected: true,
            relayReachable: true,
            requestAccepted: true,
          });
        }
        // Handle response event (optional - we don't need to decrypt it for connection test)
        else if (
          Array.isArray(data) &&
          data[0] === "EVENT" &&
          data[1] === subId
        ) {
          console.log(
            "NWC Connection Test: Received response event (connection works)"
          );
          requestAccepted = true;
          clearTimeout(timeout);
          ws.close();
          resolve({
            connected: true,
            relayReachable: true,
            requestAccepted: true,
          });
        }
      } catch (error) {
        console.error("NWC Connection Test: Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      console.error("NWC Connection Test: WebSocket error:", error);
      ws.close();
      reject(new Error(`WebSocket connection error: ${relay}`));
    };

    ws.onclose = () => {
      if (relayConnected && requestSent && !requestAccepted) {
        // Connection worked, request sent, but no OK - might be method not supported
        resolve({
          connected: true,
          relayReachable: true,
          requestAccepted: false,
          error: `Connection works but ${method} method may not be supported`,
        });
      }
    };
  });
}

async function testRelayConnectivity(
  relay: string
): Promise<NWCConnectionResult> {
  return new Promise<NWCConnectionResult>((resolve) => {
    const ws = new WebSocket(relay);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        connected: false,
        relayReachable: false,
        requestAccepted: false,
        error: `Failed to connect to relay: ${relay}`,
      });
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resolve({
        connected: true,
        relayReachable: true,
        requestAccepted: false,
        error: "Relay is reachable but wallet may not be responding",
      });
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      ws.close();
      resolve({
        connected: false,
        relayReachable: false,
        requestAccepted: false,
        error: `Cannot connect to relay: ${relay}`,
      });
    };
  });
}
