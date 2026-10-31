/**
 * NIP-C1 kind 30509 — proof that a Nostr key controls an APK signing certificate.
 * Zapstore lists an Android app only when the APK's certificate hash matches
 * one of these proofs. gittr checks the proof; it does not create it.
 * Creating it needs the signing keystore (`zsp`, “Prove it’s yours”).
 */

export const KIND_APK_IDENTITY_PROOF = 30509;

const PROOF_MESSAGE =
  "Verifying at %created% until %expiry% that I control the following Nostr public key: %pubkey%";

export type ApkProofFailure =
  | "missing"
  | "expired"
  | "revoked"
  | "mismatch"
  | "unreachable";

export type ApkProofCheck =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: ApkProofFailure };

type ProofEvent = {
  kind?: number;
  pubkey?: string;
  created_at?: number;
  content?: string;
  tags?: string[][];
};

type SubscribeFn = (
  filters: unknown[],
  relays: string[],
  onEvent: (event: unknown, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: unknown
) => () => void;

function tagValue(event: ProofEvent, name: string): string | null {
  let found: string | null = null;
  for (const tag of event.tags || []) {
    if (tag[0] !== name) continue;
    if (found != null || tag.length !== 2 || !tag[1]) return null;
    found = tag[1];
  }
  return found;
}

function hasTag(event: ProofEvent, name: string): boolean {
  return (event.tags || []).some((tag) => tag[0] === name);
}

export function apkIdentityProofMessage(args: {
  createdAt: number;
  expiry: number;
  pubkeyHex: string;
}): string {
  return PROOF_MESSAGE.replace("%created%", String(args.createdAt))
    .replace("%expiry%", String(args.expiry))
    .replace("%pubkey%", args.pubkeyHex.toLowerCase());
}

export function standardBase64ToBytes(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!trimmed || /[^A-Za-z0-9+/=]/.test(trimmed)) return null;
  try {
    const bin = atob(trimmed);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function readTlv(
  bytes: Uint8Array,
  offset: number
): { tag: number; start: number; valueStart: number; end: number } | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const tag = bytes[offset]!;
  let cursor = offset + 1;
  if (cursor >= bytes.length) return null;
  let length = bytes[cursor]!;
  cursor += 1;
  if (length & 0x80) {
    const octets = length & 0x7f;
    if (octets === 0 || octets > 4 || cursor + octets > bytes.length)
      return null;
    length = 0;
    for (let i = 0; i < octets; i++) length = length * 256 + bytes[cursor + i]!;
    cursor += octets;
  }
  const end = cursor + length;
  if (end > bytes.length) return null;
  return { tag, start: offset, valueStart: cursor, end };
}

/** SubjectPublicKeyInfo bytes from an X.509 certificate DER. */
export function subjectPublicKeyInfo(certDer: Uint8Array): Uint8Array | null {
  const cert = readTlv(certDer, 0);
  if (!cert || cert.tag !== 0x30 || cert.start !== 0) return null;
  const tbs = readTlv(certDer, cert.valueStart);
  if (!tbs || tbs.tag !== 0x30) return null;
  let cursor = tbs.valueStart;
  const first = readTlv(certDer, cursor);
  if (!first) return null;
  if (first.tag === 0xa0) cursor = first.end;
  for (let i = 0; i < 5; i++) {
    const field = readTlv(certDer, cursor);
    if (!field) return null;
    cursor = field.end;
  }
  const spki = readTlv(certDer, cursor);
  if (!spki || spki.tag !== 0x30) return null;
  return certDer.subarray(spki.start, spki.end);
}

function containsBytes(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function derInteger(
  bytes: Uint8Array,
  offset: number,
  size: number
): Uint8Array | null {
  const tlv = readTlv(bytes, offset);
  if (!tlv || tlv.tag !== 0x02) return null;
  let value = bytes.subarray(tlv.valueStart, tlv.end);
  while (value.length > 1 && value[0] === 0) value = value.subarray(1);
  if (value.length > size) return null;
  const out = new Uint8Array(size);
  out.set(value, size - value.length);
  return out;
}

/** Go's ECDSA ASN.1 signature → WebCrypto P-256 raw r||s. */
export function ecdsaDerToP1363(der: Uint8Array, size = 32): Uint8Array | null {
  const seq = readTlv(der, 0);
  if (!seq || seq.tag !== 0x30 || seq.start !== 0) return null;
  const r = derInteger(der, seq.valueStart, size);
  if (!r) return null;
  const rTlv = readTlv(der, seq.valueStart);
  if (!rTlv) return null;
  const s = derInteger(der, rTlv.end, size);
  if (!s) return null;
  const out = new Uint8Array(size * 2);
  out.set(r, 0);
  out.set(s, size);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function certificateSignatureOk(args: {
  spki: Uint8Array;
  signature: Uint8Array;
  message: string;
}): Promise<boolean> {
  const encoded = new TextEncoder().encode(args.message);
  const rsaOid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
  const ecOid = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
  if (containsBytes(args.spki, rsaOid)) {
    const key = await crypto.subtle.importKey(
      "spki",
      args.spki as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      args.signature as BufferSource,
      encoded
    );
  }
  if (containsBytes(args.spki, ecOid)) {
    const raw = ecdsaDerToP1363(args.signature, 32);
    if (!raw) return false;
    const key = await crypto.subtle.importKey(
      "spki",
      args.spki as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      raw as BufferSource,
      encoded
    );
  }
  return false;
}

function authorizesSigner(event: ProofEvent, signerPubkeyHex: string): boolean {
  const signer = signerPubkeyHex.toLowerCase();
  const author = (event.pubkey || "").toLowerCase();
  if (author === signer) return true;
  const delegation = (tagValue(event, "delegation") || "").toLowerCase();
  return delegation === signer;
}

/**
 * Accept a kind 30509 event for this certificate and signer.
 * The certificate signature is checked. Relay delivery already checked the Nostr signature.
 */
export async function verifyApkIdentityProofEvent(args: {
  event: ProofEvent;
  certificateDer: Uint8Array;
  signerPubkeyHex: string;
  now?: number;
}): Promise<ApkProofCheck> {
  const event = args.event;
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (event.kind !== KIND_APK_IDENTITY_PROOF)
    return { ok: false, reason: "mismatch" };
  if ((event.content || "") !== "") return { ok: false, reason: "mismatch" };
  if (!authorizesSigner(event, args.signerPubkeyHex)) {
    return { ok: false, reason: "mismatch" };
  }
  const author = (event.pubkey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(author)) return { ok: false, reason: "mismatch" };
  const certHash = (tagValue(event, "d") || "").toLowerCase();
  const expiryText = tagValue(event, "expiry");
  const signatureText = tagValue(event, "signature");
  if (!/^[0-9a-f]{64}$/.test(certHash) || !expiryText || !signatureText) {
    return { ok: false, reason: "mismatch" };
  }
  if (!/^[0-9]+$/.test(expiryText)) return { ok: false, reason: "mismatch" };
  const expiry = Number(expiryText);
  const createdAt = event.created_at;
  if (!Number.isSafeInteger(createdAt) || createdAt == null) {
    return { ok: false, reason: "mismatch" };
  }
  if (expiry <= createdAt) return { ok: false, reason: "mismatch" };
  const actualHash = await sha256Hex(args.certificateDer);
  if (actualHash !== certHash) return { ok: false, reason: "mismatch" };
  const embedded = tagValue(event, "cert");
  if (embedded) {
    const embeddedDer = standardBase64ToBytes(embedded);
    if (!embeddedDer || embeddedDer.length !== args.certificateDer.length) {
      return { ok: false, reason: "mismatch" };
    }
    for (let i = 0; i < embeddedDer.length; i++) {
      if (embeddedDer[i] !== args.certificateDer[i]) {
        return { ok: false, reason: "mismatch" };
      }
    }
  }
  const signature = standardBase64ToBytes(signatureText);
  const spki = subjectPublicKeyInfo(args.certificateDer);
  if (!signature || !spki) return { ok: false, reason: "mismatch" };
  const message = apkIdentityProofMessage({
    createdAt,
    expiry,
    pubkeyHex: author,
  });
  try {
    const ok = await certificateSignatureOk({ spki, signature, message });
    if (!ok) return { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "mismatch" };
  }
  if (hasTag(event, "revoked")) return { ok: false, reason: "revoked" };
  if (now >= expiry) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt: expiry };
}

function queryProofEvents(args: {
  subscribe: SubscribeFn;
  relays: string[];
  signerPubkeyHex: string;
  certificateHash: string;
  timeoutMs: number;
}): Promise<ProofEvent[]> {
  const signer = args.signerPubkeyHex.toLowerCase();
  const hash = args.certificateHash.toLowerCase();
  return new Promise((resolve, reject) => {
    const byId = new Map<string, ProofEvent>();
    let settled = false;
    let unsub: (() => void) | undefined;
    const finish = (events: ProofEvent[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve(events);
    };
    const timer = setTimeout(() => finish([...byId.values()]), args.timeoutMs);
    try {
      unsub = args.subscribe(
        [
          { kinds: [KIND_APK_IDENTITY_PROOF], "#d": [hash], limit: 20 },
          {
            kinds: [KIND_APK_IDENTITY_PROOF],
            authors: [signer],
            limit: 20,
          },
        ],
        args.relays,
        (event) => {
          const ev = event as ProofEvent & { id?: string };
          const id = ev.id || `${ev.pubkey}:${ev.created_at}`;
          byId.set(id, ev);
        },
        undefined,
        (relayUrl) => {
          // A fast empty relay must not end the search before Zapstore answers.
          if (relayUrl && relayUrl.includes("zapstore")) {
            setTimeout(() => finish([...byId.values()]), 500);
          }
        }
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** Newest kind 30509 on the catalog relays that proves this signer controls the certificate. */
export async function findAuthorizingApkProof(args: {
  subscribe: SubscribeFn;
  relays: string[];
  signerPubkeyHex: string;
  certificateDer: Uint8Array;
  certificateHash: string;
  timeoutMs?: number;
  now?: number;
}): Promise<ApkProofCheck> {
  let events: ProofEvent[];
  try {
    events = await queryProofEvents({
      subscribe: args.subscribe,
      relays: args.relays,
      signerPubkeyHex: args.signerPubkeyHex,
      certificateHash: args.certificateHash,
      timeoutMs: args.timeoutMs ?? 8_000,
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const mine = events
    .filter((event) => authorizesSigner(event, args.signerPubkeyHex))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (mine.length === 0) return { ok: false, reason: "missing" };
  return verifyApkIdentityProofEvent({
    event: mine[0]!,
    certificateDer: args.certificateDer,
    signerPubkeyHex: args.signerPubkeyHex,
    now: args.now,
  });
}
