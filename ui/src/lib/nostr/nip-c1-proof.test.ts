import { createSign, generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";

import {
  apkIdentityProofMessage,
  ecdsaDerToP1363,
  findAuthorizingApkProof,
  subjectPublicKeyInfo,
  verifyApkIdentityProofEvent,
} from "./nip-c1-proof";

const PUBKEY = "ab".repeat(32);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  let len: Uint8Array;
  if (value.length < 128) len = Uint8Array.of(value.length);
  else if (value.length < 256) len = Uint8Array.of(0x81, value.length);
  else len = Uint8Array.of(0x82, value.length >> 8, value.length & 0xff);
  return concat(Uint8Array.of(tag), len, value);
}

function seq(children: Uint8Array[]): Uint8Array {
  return tlv(0x30, concat(...children));
}

function wrapSpki(spki: Uint8Array): Uint8Array {
  const oid = tlv(
    0x06,
    Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b)
  );
  const alg = seq([oid, tlv(0x05, new Uint8Array())]);
  const cn = tlv(0x0c, new TextEncoder().encode("test"));
  const name = seq([
    tlv(0x31, seq([tlv(0x06, Uint8Array.of(0x55, 0x04, 0x03)), cn])),
  ]);
  const utc = (value: string) => tlv(0x17, new TextEncoder().encode(value));
  const tbs = seq([
    tlv(0xa0, tlv(0x02, Uint8Array.of(2))),
    tlv(0x02, Uint8Array.of(1)),
    alg,
    name,
    seq([utc("250101000000Z"), utc("491231235959Z")]),
    name,
    spki,
  ]);
  const sig = tlv(0x03, concat(Uint8Array.of(0), new Uint8Array(8)));
  return seq([tbs, alg, sig]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("NIP-C1 APK identity proof", () => {
  it("accepts an RSA certificate signature over zsp’s proof message", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey)
    );
    const cert = wrapSpki(spki);
    expect(subjectPublicKeyInfo(cert)).toEqual(spki);
    const createdAt = 1_700_000_000;
    const expiry = createdAt + 86_400;
    const message = apkIdentityProofMessage({
      createdAt,
      expiry,
      pubkeyHex: PUBKEY,
    });
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        pair.privateKey,
        new TextEncoder().encode(message)
      )
    );
    const check = await verifyApkIdentityProofEvent({
      certificateDer: cert,
      signerPubkeyHex: PUBKEY,
      now: createdAt + 10,
      event: {
        kind: 30509,
        pubkey: PUBKEY,
        created_at: createdAt,
        content: "",
        tags: [
          ["d", await sha256Hex(cert)],
          ["signature", b64(signature)],
          ["expiry", String(expiry)],
        ],
      },
    });
    expect(check).toEqual({ ok: true, expiresAt: expiry });
  });

  it("accepts a P-256 signature in the DER form zsp publishes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const spki = new Uint8Array(
      publicKey.export({ type: "spki", format: "der" })
    );
    const cert = wrapSpki(spki);
    const createdAt = 1_700_000_000;
    const expiry = createdAt + 86_400;
    const message = apkIdentityProofMessage({
      createdAt,
      expiry,
      pubkeyHex: PUBKEY,
    });
    const signer = createSign("SHA256");
    signer.update(message);
    signer.end();
    const der = new Uint8Array(signer.sign(privateKey));
    expect(ecdsaDerToP1363(der)?.length).toBe(64);
    const check = await verifyApkIdentityProofEvent({
      certificateDer: cert,
      signerPubkeyHex: PUBKEY,
      now: createdAt + 10,
      event: {
        kind: 30509,
        pubkey: PUBKEY,
        created_at: createdAt,
        content: "",
        tags: [
          ["d", await sha256Hex(cert)],
          ["signature", b64(der)],
          ["expiry", String(expiry)],
        ],
      },
    });
    expect(check.ok).toBe(true);
  });

  it("rejects a proof whose certificate signature does not match", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey)
    );
    const cert = wrapSpki(spki);
    const createdAt = 1_700_000_000;
    const expiry = createdAt + 86_400;
    const check = await verifyApkIdentityProofEvent({
      certificateDer: cert,
      signerPubkeyHex: PUBKEY,
      now: createdAt + 10,
      event: {
        kind: 30509,
        pubkey: PUBKEY,
        created_at: createdAt,
        content: "",
        tags: [
          ["d", await sha256Hex(cert)],
          ["signature", b64(new Uint8Array(256))],
          ["expiry", String(expiry)],
        ],
      },
    });
    expect(check).toEqual({ ok: false, reason: "mismatch" });
  });

  it("reports an expired proof after the signature checks out", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey)
    );
    const cert = wrapSpki(spki);
    const createdAt = 1_700_000_000;
    const expiry = createdAt + 100;
    const message = apkIdentityProofMessage({
      createdAt,
      expiry,
      pubkeyHex: PUBKEY,
    });
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        pair.privateKey,
        new TextEncoder().encode(message)
      )
    );
    const check = await verifyApkIdentityProofEvent({
      certificateDer: cert,
      signerPubkeyHex: PUBKEY,
      now: expiry + 1,
      event: {
        kind: 30509,
        pubkey: PUBKEY,
        created_at: createdAt,
        content: "",
        tags: [
          ["d", await sha256Hex(cert)],
          ["signature", b64(signature)],
          ["expiry", String(expiry)],
        ],
      },
    });
    expect(check).toEqual({ ok: false, reason: "expired" });
  });

  it("uses the proof Zapstore’s relay returns for this certificate", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey)
    );
    const cert = wrapSpki(spki);
    const hash = await sha256Hex(cert);
    const createdAt = 1_700_000_000;
    const expiry = createdAt + 86_400;
    const message = apkIdentityProofMessage({
      createdAt,
      expiry,
      pubkeyHex: PUBKEY,
    });
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        pair.privateKey,
        new TextEncoder().encode(message)
      )
    );
    const found = await findAuthorizingApkProof({
      signerPubkeyHex: PUBKEY,
      certificateDer: cert,
      certificateHash: hash,
      relays: ["wss://relay.zapstore.dev"],
      now: createdAt + 5,
      subscribe: (_filters, _relays, onEvent, _delay, onEose) => {
        onEvent(
          {
            id: "c".repeat(64),
            kind: 30509,
            pubkey: PUBKEY,
            created_at: createdAt,
            content: "",
            tags: [
              ["d", hash],
              ["signature", b64(signature)],
              ["expiry", String(expiry)],
            ],
          },
          false,
          "wss://relay.zapstore.dev"
        );
        onEose?.("wss://relay.zapstore.dev", createdAt);
        return () => undefined;
      },
    });
    expect(found).toEqual({ ok: true, expiresAt: expiry });
  });
});
