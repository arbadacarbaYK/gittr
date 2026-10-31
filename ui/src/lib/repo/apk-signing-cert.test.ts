import { describe, expect, it } from "vitest";

import {
  apkSigningCertificateFromBlock,
  centralDirectoryOffsetFromSuffix,
  signingBlockByteRange,
} from "./apk-signing-cert";

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, n, true);
  return bytes;
}

function u32(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
}

function u64(n: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, n >>> 0, true);
  view.setUint32(4, Math.floor(n / 2 ** 32), true);
  return bytes;
}

function lp(payload: Uint8Array): Uint8Array {
  return concat(u32(payload.length), payload);
}

function signer(cert: Uint8Array, minSdk?: number): Uint8Array {
  const digest = concat(u32(0x0103), lp(new Uint8Array(32)));
  const digests = lp(lp(digest));
  const certs = lp(lp(cert));
  const rest =
    minSdk == null
      ? lp(new Uint8Array(0))
      : concat(u32(minSdk), u32(0x7fffffff), lp(new Uint8Array(0)));
  const signed = lp(concat(digests, certs, rest));
  return lp(concat(signed, lp(new Uint8Array(0)), lp(Uint8Array.of(1))));
}

function idValue(id: number, value: Uint8Array): Uint8Array {
  return concat(u64(4 + value.length), u32(id), value);
}

function signingBlock(pairs: Uint8Array): Uint8Array {
  const size = pairs.length + 8 + 16;
  return concat(
    u64(size),
    pairs,
    u64(size),
    new TextEncoder().encode("APK Sig Block 42")
  );
}

function apkAround(block: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode("AndroidManifest.xml");
  const data = Uint8Array.of(1, 2, 3, 4);
  const local = concat(
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    name,
    data
  );
  const cd = concat(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name
  );
  const cdOffset = local.length + block.length;
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(cd.length),
    u32(cdOffset),
    u16(0)
  );
  return concat(local, block, cd, eocd);
}

function certBytes(seed: number): Uint8Array {
  return Uint8Array.from({ length: 48 }, (_, i) => (seed + i) & 0xff);
}

describe("apk signing certificate", () => {
  it("reads the v2 certificate from the signing block before the zip central directory", () => {
    const cert = certBytes(9);
    const apk = apkAround(signingBlock(idValue(0x7109871a, lp(signer(cert)))));
    const cdOffset = centralDirectoryOffsetFromSuffix({
      tail: apk,
      tailStart: 0,
      fileSize: apk.length,
    });
    expect(cdOffset).toBeGreaterThan(24);
    const footer = apk.subarray(cdOffset! - 24, cdOffset!);
    const range = signingBlockByteRange(cdOffset!, footer);
    expect(range).not.toBeNull();
    const parsed = apkSigningCertificateFromBlock(
      apk.subarray(range!.start, range!.endInclusive + 1)
    );
    expect(parsed).toEqual(cert);
  });

  it("still finds the central directory from a short suffix of the file", () => {
    const cert = certBytes(3);
    const apk = apkAround(signingBlock(idValue(0x7109871a, lp(signer(cert)))));
    const tail = apk.subarray(apk.length - 40);
    expect(
      centralDirectoryOffsetFromSuffix({
        tail,
        tailStart: apk.length - 40,
        fileSize: apk.length,
      })
    ).toBe(
      centralDirectoryOffsetFromSuffix({
        tail: apk,
        tailStart: 0,
        fileSize: apk.length,
      })
    );
  });

  it("prefers the v3 signer with the higher minSdk", () => {
    const older = certBytes(1);
    const newer = certBytes(2);
    const block = signingBlock(
      idValue(0xf05368c0, lp(concat(signer(older, 21), signer(newer, 28))))
    );
    expect(apkSigningCertificateFromBlock(block)).toEqual(newer);
  });

  it("ignores a zip that has no APK signing block", () => {
    const apk = apkAround(new Uint8Array(32));
    const cdOffset = centralDirectoryOffsetFromSuffix({
      tail: apk,
      tailStart: 0,
      fileSize: apk.length,
    });
    const footer = apk.subarray((cdOffset ?? 0) - 24, cdOffset ?? 0);
    expect(signingBlockByteRange(cdOffset ?? 0, footer)).toBeNull();
  });
});
