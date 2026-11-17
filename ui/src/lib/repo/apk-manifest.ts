/**
 * Android versionCode from an APK's binary AndroidManifest.xml.
 * Zapstore refuses a kind 3063 file that does not carry this number.
 */

const MANIFEST_NAME = "AndroidManifest.xml";

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint32(offset, true);
}

function i32(bytes: Uint8Array, offset: number): number {
  return view(bytes).getInt32(offset, true);
}

function findEocd(bytes: Uint8Array): number | null {
  const min = Math.max(0, bytes.length - (65535 + 22));
  for (let i = bytes.length - 22; i >= min; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return null;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(
      new DecompressionStream("deflate-raw")
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function poolString(
  bytes: Uint8Array,
  poolOffset: number,
  index: number
): string | null {
  if (index < 0 || (index >>> 0) === 0xffffffff) return null;
  const headerSize = u16(bytes, poolOffset + 2);
  const stringCount = u32(bytes, poolOffset + 8);
  if (index >= stringCount) return null;
  const flags = u32(bytes, poolOffset + 16);
  const stringsStart = u32(bytes, poolOffset + 20);
  const offsetPos = poolOffset + headerSize + index * 4;
  if (offsetPos + 4 > bytes.length) return null;
  const start = poolOffset + stringsStart + u32(bytes, offsetPos);
  if (start < 0 || start >= bytes.length) return null;
  const utf8 = (flags & (1 << 8)) !== 0;
  if (!utf8) {
    if (start + 2 > bytes.length) return null;
    const chars = u16(bytes, start);
    const end = start + 2 + chars * 2;
    if (end > bytes.length) return null;
    return new TextDecoder("utf-16le").decode(bytes.subarray(start + 2, end));
  }
  let cursor = start;
  const readUtf8Len = () => {
    const first = bytes[cursor];
    cursor += 1;
    if (first === undefined) return null;
    if ((first & 0x80) === 0) return first;
    const second = bytes[cursor];
    cursor += 1;
    if (second === undefined) return null;
    return ((first & 0x7f) << 8) | second;
  };
  if (readUtf8Len() == null) return null;
  const byteLen = readUtf8Len();
  if (byteLen == null || cursor + byteLen > bytes.length) return null;
  return new TextDecoder().decode(bytes.subarray(cursor, cursor + byteLen));
}

/** Decimal Android versionCode from a binary AndroidManifest.xml. */
export function versionCodeFromBinaryXml(bytes: Uint8Array): string | null {
  if (bytes.length < 8 || u16(bytes, 0) !== 0x0003) return null;
  const poolOffset = u16(bytes, 2);
  if (poolOffset + 28 > bytes.length || u16(bytes, poolOffset) !== 0x0001) {
    return null;
  }
  const poolSize = u32(bytes, poolOffset + 4);
  let pos = poolOffset + poolSize;
  while (pos + 8 <= bytes.length) {
    const type = u16(bytes, pos);
    const headerSize = u16(bytes, pos + 2);
    const size = u32(bytes, pos + 4);
    if (size < 8 || pos + size > bytes.length) return null;
    if (type === 0x0102 && headerSize >= 16 && pos + headerSize + 16 <= bytes.length) {
      const name = poolString(
        bytes,
        poolOffset,
        u32(bytes, pos + headerSize + 4)
      );
      const attrStart = u16(bytes, pos + headerSize + 8);
      const attrSize = u16(bytes, pos + headerSize + 10);
      const attrCount = u16(bytes, pos + headerSize + 12);
      if (name === "manifest" && attrSize >= 20) {
        const base = pos + headerSize + attrStart;
        for (let i = 0; i < attrCount; i++) {
          const at = base + i * attrSize;
          if (at + 20 > bytes.length) break;
          const attrName = poolString(bytes, poolOffset, u32(bytes, at + 4));
          if (attrName !== "versionCode") continue;
          const dataType = bytes[at + 15] ?? 0;
          const data = i32(bytes, at + 16);
          if (dataType >= 0x10 && dataType <= 0x1f && data > 0) {
            return String(data);
          }
          return null;
        }
      }
    }
    pos += size;
  }
  return null;
}

function entryFromCentral(
  bytes: Uint8Array,
  cursor: number
): { name: string; method: number; compressedSize: number; localOffset: number; next: number } | null {
  if (cursor + 46 > bytes.length || u32(bytes, cursor) !== 0x02014b50) return null;
  const method = u16(bytes, cursor + 10);
  const compressedSize = u32(bytes, cursor + 20);
  const nameLen = u16(bytes, cursor + 28);
  const extraLen = u16(bytes, cursor + 30);
  const commentLen = u16(bytes, cursor + 32);
  const localOffset = u32(bytes, cursor + 42);
  const nameEnd = cursor + 46 + nameLen;
  if (nameEnd > bytes.length) return null;
  const name = new TextDecoder().decode(bytes.subarray(cursor + 46, nameEnd));
  return {
    name,
    method,
    compressedSize,
    localOffset,
    next: nameEnd + extraLen + commentLen,
  };
}

/**
 * versionCode from an APK. `tail` is a suffix of the file (`tailStart` is its
 * absolute offset). Local file bytes outside that suffix are loaded with `readRange`.
 */
export async function apkVersionCodeFromZip(args: {
  tail: Uint8Array;
  tailStart: number;
  fileSize: number;
  readRange?: (
    start: number,
    endInclusive: number
  ) => Promise<Uint8Array | undefined>;
}): Promise<string | null> {
  const { tail, tailStart, fileSize } = args;
  if (tailStart < 0 || tailStart + tail.length !== fileSize) return null;
  const read = async (start: number, endInclusive: number) => {
    if (start >= tailStart && endInclusive < fileSize) {
      return tail.subarray(start - tailStart, endInclusive + 1 - tailStart);
    }
    return args.readRange?.(start, endInclusive);
  };
  const eocdRel = findEocd(tail);
  if (eocdRel == null) return null;
  const cdSize = u32(tail, eocdRel + 12);
  const cdOffset = u32(tail, eocdRel + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) return null;
  const cd = await read(cdOffset, cdOffset + cdSize - 1);
  if (!cd) return null;
  let cursor = 0;
  let found: { method: number; compressedSize: number; localOffset: number } | null =
    null;
  while (cursor + 46 <= cd.length) {
    const entry = entryFromCentral(cd, cursor);
    if (!entry || entry.next <= cursor) break;
    if (entry.name === MANIFEST_NAME) {
      found = entry;
      break;
    }
    cursor = entry.next;
  }
  if (!found || found.compressedSize <= 0) return null;
  const header = await read(found.localOffset, found.localOffset + 29);
  if (!header || header.length < 30 || u32(header, 0) !== 0x04034b50) return null;
  const dataStart =
    found.localOffset + 30 + u16(header, 26) + u16(header, 28);
  const compressed = await read(dataStart, dataStart + found.compressedSize - 1);
  if (!compressed || compressed.length !== found.compressedSize) return null;
  const xml =
    found.method === 0
      ? compressed
      : found.method === 8
        ? await inflateRaw(compressed)
        : null;
  if (!xml) return null;
  return versionCodeFromBinaryXml(xml);
}

/** versionCode from a complete APK (zip) byte string. */
export async function apkVersionCodeFromZipBytes(
  bytes: Uint8Array
): Promise<string | null> {
  return apkVersionCodeFromZip({
    tail: bytes,
    tailStart: 0,
    fileSize: bytes.length,
  });
}
