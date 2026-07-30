# NWC (Nostr Wallet Connect) Implementation Notes

## Current Implementation

We're implementing NIP-47 directly without external npm packages for full control and to avoid dependencies. However, there are npm packages available if we need to switch:

- **@getalby/sdk** (v6.0.2) - Official Alby SDK with NWC support
- **applesauce-wallet-connect** (v4.1.0) - NWC implementation for clients and services

## Relay policy (why we differ from many clients)

**Problem:** A lot of NWC UIs only publish/subscribe payment RPC on a **fixed app relay pool** (or a short allow-list of “popular” relays) and **do not use — or do not fall back to — the `relay=` query param in the NWC string**. Wallets that only listen on that URI relay (self-hosted LNbits, Umbrel, custom NWC services) then look “broken”: connect test fails, `pay_invoice` never gets a `23195`, even though the URI is valid.

**gittr rule:** The `relay` inside `nostr+walletconnect://…` is the **sole transport** for NWC.

1. Parse `relay` + `secret` + wallet pubkey from the URI (`nwc-balance.ts`, `nwc-connection-test.ts`, `payment-qr.tsx`).
2. Open a **browser WebSocket straight to that URL** (client-side only — secret never hits our server).
3. Do **not** require that relay to appear under Settings → Relays.
4. Do **not** rewrite NWC traffic onto damus / primal / user GRASP lists “for convenience”.

App relays stay for NIP-34 / zaps / social events. NWC transport stays on the wallet’s advertised relay — same separation we keep for NIP-46 bunker URI relays vs publish relays.

Teaching extract: [gittr-helper-tools `nip47-nwc`](https://github.com/arbadacarbaYK/gittr-helper-tools/tree/main/snippets/nip47-nwc).

## NIP-47 Specification Compliance

### Payment Flow

1. **Payment is Lightning Network payment** from lnaddress to lnaddress
   - Sender's NWC wallet → creates payment
   - Recipient's lnaddress/lnurl → receives payment
   - Both sides use correct Lightning address formatting

2. **Request Event (Kind 23194)**:
   ```typescript
   {
     kind: 23194,
     pubkey: clientPubkey,  // Client's public key
     content: encryptedPayload,  // NIP-04 encrypted JSON
     tags: [['p', walletPubkey]],  // Wallet's pubkey
     created_at: timestamp
   }
   ```
   - Encrypted payload: `{ method: 'pay_invoice', params: { invoice: 'lnbc...' } }`
   - Signed with client's secret key

3. **Response Event (Kind 23195)**:
   ```typescript
   {
     kind: 23195,
     pubkey: walletPubkey,  // Wallet's public key
     content: encryptedResponse,  // NIP-04 encrypted JSON
     tags: [
       ['e', requestEventId],  // ⚠️ CRITICAL: Must reference request event ID
       ['p', clientPubkey]  // Optional: Client's pubkey
     ],
     created_at: timestamp
   }
   ```
   - Encrypted response: `{ result: { preimage: '...' } }` or `{ error: {...} }`

## Key Fix: `e` Tag Verification

**Issue Found**: We were NOT checking the `e` tag in response events, which NIP-47 requires.

The `e` tag must contain the request event ID to link response to request. We now verify:
```typescript
const eTag = event.tags?.find((tag: any) => tag[0] === 'e');
const responseRequestId = eTag?.[1];
if (responseRequestId !== paymentEvent.id) {
  // Not our response - ignore
  return;
}
```

## Why It Might Still Not Work

Even with NIP-47 compliance, possible issues:

1. **Wallet Implementation Differences**:
   - Some wallets may not include `e` tag (non-compliant)
   - Some wallets may use different relay filtering

2. **Relay Filtering Limitations**:
   - Not all relays support filtering by `e` tags in subscriptions
   - We subscribe broadly then filter client-side (correct approach)

3. **Timing Issues**:
   - Wallet might respond slowly
   - Relay might delay events
   - We wait up to 30 seconds (reasonable)

4. **Encryption/Decryption**:
   - Must use correct secret key (hex format)
   - Must use correct wallet pubkey for encryption target
   - NIP-04 encryption must match wallet's implementation

5. **Invoice Format**:
   - Invoice must be valid BOLT11
   - Wallet must be able to decode and pay it
   - Invoice should be payable by the wallet

## Debugging Checklist

- [x] Request event has correct `kind: 23194`
- [x] Request event has `tags: [['p', walletPubkey]]`
- [x] Request event is signed with client secret
- [x] Request content is encrypted with NIP-04
- [x] Subscription filters for `kind: 23195` from wallet
- [x] Response event verified by `e` tag matching request ID
- [x] Response decrypted with correct keys
- [ ] Verified wallet actually received and processed request
- [ ] Verified relay is delivering events correctly
- [ ] Verified invoice is valid and payable

## Using Alby SDK (Alternative Approach)

According to [nwc.dev documentation](https://docs.nwc.dev/bitcoin-apps-and-websites/getting-started), the recommended approach is:

```bash
npm install @getalby/sdk
```

Then use:
```typescript
import { webln } from "@getalby/sdk";

const nwc = new webln.NWC({ nostrWalletConnectUrl });
await nwc.enable();
const response = await nwc.sendPayment(invoice);
```

**Benefits of using Alby SDK**:
- Battle-tested implementation used by many apps
- Handles NIP-47 complexity automatically
- Better error handling and retry logic
- Maintained by Alby team

**Why we're implementing manually**:
- Full control over the flow
- No external dependencies
- Custom error handling
- Learning/understanding NIP-47 deeply

**Current Status**: We've implemented NIP-47 manually with `e` tag verification. If issues persist, we should consider switching to `@getalby/sdk` or comparing our implementation against theirs to find differences.

## Related: NIP-46 is not NWC

Remote signer auth (**NIP-46**, kinds `24133`) and NWC payments (**NIP-47**, kinds `23194`/`23195`) both use encrypted RPC over relays, but they are separate protocols and secrets. Teaching extract for other apps: [gittr-helper-tools `nip47-nwc`](https://github.com/arbadacarbaYK/gittr-helper-tools/tree/main/snippets/nip47-nwc). Platform listing: [`docs/NIPS_AND_EVENT_KINDS.md`](../docs/NIPS_AND_EVENT_KINDS.md) § NIP-47.

