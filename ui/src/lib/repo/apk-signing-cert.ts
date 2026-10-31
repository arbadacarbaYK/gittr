/**
 * Read the current APK v2/v3 signing certificate.
 * Zapstore's ownership proof (NIP-C1) is the SHA-256 of this certificate's
 * DER bytes — the same value `apksigner` and `zsp` call the certificate hash.
 * The certificate is public. The signing key never leaves the developer's machine.
 */

const APK_SIG_BLOCK_MAGIC = "APK Sig Block 42";
const SCHEME_V2 = 0x7109871a;
const SCHEME_V3 = 0xf05368c0;
const SCHEME_V31 = 0x1b93ad61;
const MAX_SIGNING_BLOCK_BYTES = 8 * 1024 * 1024;

export type ApkSigningBlockRange = { start: number; endInclusive: number };

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint32(offset, true);
}

function readU64(bytes: Uint8Array, offset: number): number {
  const view = dataView(bytes);
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 2 ** 32 + lo;
}

function ascii(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** SHA-256 hex of the certificate DER. This is NIP-C1 `d` / `apk_certificate_hash`. */
export async function apkCertificateHashHex(der: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", der as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function findEocdIndex(tail: Uint8Array): number | null {
  const min = Math.max(0, tail.length - (65535 + 22));
  for (let i = tail.length - 22; i >= min; i--) {
    if (
      tail[i] !== 0x50 ||
      tail[i + 1] !== 0x4b ||
      tail[i + 2] !== 0x05 ||
      tail[i + 3] !== 0x06
    ) {
      continue;
    }
    const commentLen = readU16(tail, i + 20);
    if (i + 22 + commentLen === tail.length) return i;
  }
  return null;
}

/**
 * Absolute central-directory offset. `tail` must be a suffix of the APK
 * (`tailStart + tail.length === fileSize`).
 */
export function centralDirectoryOffsetFromSuffix(args: {
  tail: Uint8Array;
  tailStart: number;
  fileSize: number;
}): number | null {
  const { tail, tailStart, fileSize } = args;
  if (tailStart < 0 || tail.length < 22) return null;
  if (tailStart + tail.length !== fileSize) return null;
  const eocd = findEocdIndex(tail);
  if (eocd == null) return null;
  const cdOffset = readU32(tail, eocd + 16);
  const cdSize = readU32(tail, eocd + 12);
  if (cdOffset !== 0xffffffff && cdSize !== 0xffffffff) return cdOffset;
  if (eocd < 20) return null;
  const locator = eocd - 20;
  if (readU32(tail, locator) !== 0x07064b50) return null;
  const zip64Offset = readU64(tail, locator + 8);
  const rel = zip64Offset - tailStart;
  if (rel < 0 || rel + 56 > tail.length) return null;
  if (readU32(tail, rel) !== 0x06064b50) return null;
  const zip64Cd = readU64(tail, rel + 48);
  if (!Number.isSafeInteger(zip64Cd) || zip64Cd < 0) return null;
  return zip64Cd;
}

/** Byte range of the APK Signing Block ending at `cdOffset`, from its 24-byte footer. */
export function signingBlockByteRange(
  cdOffset: number,
  footer: Uint8Array
): ApkSigningBlockRange | null {
  if (footer.length < 24 || cdOffset < 24) return null;
  if (ascii(footer.subarray(8, 24)) !== APK_SIG_BLOCK_MAGIC) return null;
  const size = readU64(footer, 0);
  if (
    !Number.isSafeInteger(size) ||
    size < 24 ||
    size > MAX_SIGNING_BLOCK_BYTES
  ) {
    return null;
  }
  const start = cdOffset - (size + 8);
  if (start < 0) return null;
  return { start, endInclusive: cdOffset - 1 };
}

function readLengthPrefixed(
  bytes: Uint8Array,
  offset: number
): { slice: Uint8Array; next: number } | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  const len = readU32(bytes, offset);
  const start = offset + 4;
  const end = start + len;
  if (len < 0 || end > bytes.length) return null;
  return { slice: bytes.subarray(start, end), next: end };
}

function certificatesFromScheme(
  value: Uint8Array,
  v3: boolean
): Array<{ der: Uint8Array; minSdk: number }> {
  const signers = readLengthPrefixed(value, 0);
  if (!signers) return [];
  const found: Array<{ der: Uint8Array; minSdk: number }> = [];
  let cursor = 0;
  while (cursor < signers.slice.length) {
    const signer = readLengthPrefixed(signers.slice, cursor);
    if (!signer) break;
    cursor = signer.next;
    const signed = readLengthPrefixed(signer.slice, 0);
    if (!signed) continue;
    const digests = readLengthPrefixed(signed.slice, 0);
    if (!digests) continue;
    const certs = readLengthPrefixed(signed.slice, digests.next);
    if (!certs) continue;
    const first = readLengthPrefixed(certs.slice, 0);
    if (!first || first.slice.length < 16) continue;
    let minSdk = 0;
    if (v3 && certs.next + 4 <= signed.slice.length) {
      minSdk = readU32(signed.slice, certs.next);
    }
    found.push({ der: first.slice, minSdk });
  }
  return found;
}

/** Current signer certificate from one APK Signing Block (size, pairs, size, magic). */
export function apkSigningCertificateFromBlock(
  block: Uint8Array
): Uint8Array | null {
  if (block.length < 32) return null;
  const size = readU64(block, block.length - 24);
  if (size + 8 !== block.length) return null;
  if (ascii(block.subarray(block.length - 16)) !== APK_SIG_BLOCK_MAGIC) {
    return null;
  }
  const pairs = block.subarray(8, block.length - 24);
  const v3: Array<{ der: Uint8Array; minSdk: number }> = [];
  const v2: Array<{ der: Uint8Array; minSdk: number }> = [];
  let cursor = 0;
  while (cursor + 12 <= pairs.length) {
    const pairLen = readU64(pairs, cursor);
    if (!Number.isSafeInteger(pairLen) || pairLen < 4) return null;
    const valueEnd = cursor + 8 + pairLen;
    if (valueEnd > pairs.length) return null;
    const id = readU32(pairs, cursor + 8);
    const value = pairs.subarray(cursor + 12, valueEnd);
    if (id === SCHEME_V3 || id === SCHEME_V31) {
      v3.push(...certificatesFromScheme(value, true));
    } else if (id === SCHEME_V2) {
      v2.push(...certificatesFromScheme(value, false));
    }
    cursor = valueEnd;
  }
  const pool = v3.length > 0 ? v3 : v2;
  if (pool.length === 0) return null;
  pool.sort((a, b) => b.minSdk - a.minSdk);
  return new Uint8Array(pool[0]!.der);
}
