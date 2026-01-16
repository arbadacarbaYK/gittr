// NWC balance check implementation
// This uses the same protocol as pay_invoice but with get_balance method
//
// ⚠️ PRIVACY & SECURITY: This is 100% CLIENT-SIDE ONLY
// - Secret key NEVER leaves the browser
// - WebSocket connects DIRECTLY to the Nostr relay (not through our server)
// - All encryption/decryption happens in the browser using Web Crypto API
// - No data is sent to our server - everything goes directly to the relay
// - The secret key is only used locally for signing/encrypting events
import { getEventHash, getPublicKey, nip04, signEvent } from "nostr-tools";

export interface NWCBalanceResult {
  balance: number; // Balance in millisats
  balanceSats: number; // Balance in sats
}

export async function getNWCBalance(nwcUri: string): Promise<NWCBalanceResult> {
  // Parse NWC URI
  const normalizedUri = nwcUri.replace(/^nostr\+walletconnect:/, "http:");
  const uri = new URL(normalizedUri);
  const walletPubkey =
    uri.hostname || uri.pathname.replace(/^\/+/, "").replace(/\/$/, "");
  const relay = uri.searchParams.get("relay");
  const secret = uri.searchParams.get("secret");

  if (!walletPubkey || !relay || !secret) {
    throw new Error(`Invalid NWC URI: missing walletPubkey, relay, or secret`);
  }

  const sk = secret; // hex
  const clientPubkey = getPublicKey(sk);

  console.log("NWC Balance: Connecting to relay:", relay);

  // Create get_balance request
  const requestPayload = {
    method: "get_balance",
    params: {},
  };

  // Encrypt the request
  const encryptedContent = await nip04.encrypt(
    sk,
    walletPubkey,
    JSON.stringify(requestPayload)
  );

  // Create request event (kind 23194)
  const requestEvent: any = {
    kind: 23194,
    content: encryptedContent,
    tags: [["p", walletPubkey]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: clientPubkey,
  };

  // Sign the event
  requestEvent.id = getEventHash(requestEvent);
  requestEvent.sig = signEvent(requestEvent, sk);

  console.log("NWC Balance: Request event created:", {
    id: requestEvent.id,
    kind: requestEvent.kind,
    walletPubkey,
    relay,
  });

  // Send request and wait for response
  return new Promise<NWCBalanceResult>((resolve, reject) => {
    const ws = new WebSocket(relay);
    const requestTimestamp = Math.floor(Date.now() / 1000);
    const subId = `nwc-balance-${Date.now()}`;
    let responseReceived = false;

    const timeout = setTimeout(() => {
      if (!responseReceived) {
        ws.close();
        reject(
          new Error(
            "NWC balance request timed out. This wallet may not support get_balance method. Many wallets only support pay_invoice."
          )
        );
      }
    }, 20000); // Increased timeout to 20 seconds

    ws.onopen = () => {
      console.log("NWC Balance: Connected to relay");

      // Subscribe to response events
      const subscription = [
        "REQ",
        subId,
        {
          kinds: [23195], // NIP-47 response events
          authors: [walletPubkey],
          since: requestTimestamp,
        },
      ];

      console.log("NWC Balance: Subscribing to response events");
      ws.send(JSON.stringify(subscription));

      // Wait a bit then send request
      setTimeout(() => {
        console.log("NWC Balance: Sending get_balance request");
        ws.send(JSON.stringify(["EVENT", requestEvent]));
      }, 500);
    };

    ws.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data);

        // Handle OK response
        if (
          Array.isArray(data) &&
          data[0] === "OK" &&
          data[1] === requestEvent.id
        ) {
          if (data[2] === true) {
            console.log("NWC Balance: Request accepted by relay");
          } else {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`Request rejected: ${data[2] || "unknown"}`));
          }
        }
        // Handle response event
        else if (
          Array.isArray(data) &&
          data[0] === "EVENT" &&
          data[1] === subId
        ) {
          const event = data[2];

          if (event && event.kind === 23195 && event.pubkey === walletPubkey) {
            // NIP-47 spec: Response events must have 'e' tag with request event ID
            const eTag = event.tags?.find((tag: any) => tag[0] === "e");
            const responseRequestId = eTag?.[1];

            // Verify this response is for OUR request
            if (responseRequestId !== requestEvent.id) {
              console.log(
                "NWC Balance: Ignoring response - 'e' tag doesn't match request ID:",
                {
                  responseRequestId,
                  expectedRequestId: requestEvent.id,
                }
              );
              return;
            }

            if (event.created_at >= requestTimestamp) {
              console.log(
                "NWC Balance: Received response event (matches request ID)"
              );
              responseReceived = true;

              try {
                // Decrypt response
                const decrypted = await nip04.decrypt(
                  sk,
                  walletPubkey,
                  event.content
                );
                const response = JSON.parse(decrypted);

                console.log("NWC Balance: Decrypted response:", response);

                clearTimeout(timeout);
                ws.close();

                if (response.error) {
                  const errorCode = response.error.code;
                  const errorMessage =
                    response.error.message || JSON.stringify(response.error);

                  // Check if error is "method not found" or similar
                  if (
                    errorCode === -32601 ||
                    errorMessage.toLowerCase().includes("method") ||
                    errorMessage.toLowerCase().includes("not supported")
                  ) {
                    reject(
                      new Error(
                        `get_balance method not supported by this wallet. Many wallets only support pay_invoice.`
                      )
                    );
                  } else {
                    reject(new Error(`NWC balance failed: ${errorMessage}`));
                  }
                } else if (
                  response.result &&
                  typeof response.result.balance === "number"
                ) {
                  const balanceMsat = response.result.balance;
                  resolve({
                    balance: balanceMsat,
                    balanceSats: Math.floor(balanceMsat / 1000),
                  });
                } else {
                  reject(
                    new Error(
                      `Unexpected response format: ${JSON.stringify(response)}`
                    )
                  );
                }
              } catch (decryptError: any) {
                clearTimeout(timeout);
                ws.close();
                reject(
                  new Error(
                    `Failed to decrypt response: ${decryptError.message}`
                  )
                );
              }
            }
          }
        }
      } catch (error) {
        console.error("NWC Balance: Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      console.error("NWC Balance: WebSocket error:", error);
      ws.close();
      reject(new Error("WebSocket connection error"));
    };

    ws.onclose = () => {
      if (!responseReceived) {
        console.warn("NWC Balance: WebSocket closed without response");
      }
    };
  });
}
