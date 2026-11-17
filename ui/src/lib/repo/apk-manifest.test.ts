import { existsSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  apkVersionCodeFromZipBytes,
  versionCodeFromBinaryXml,
} from "./apk-manifest";

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

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf16(value: string): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2);
  new DataView(bytes.buffer).setUint16(0, value.length, true);
  for (let i = 0; i < value.length; i++) {
    new DataView(bytes.buffer).setUint16(2 + i * 2, value.charCodeAt(i), true);
  }
  return bytes;
}

/** Binary manifest whose only attribute is versionCode. */
function manifestWithVersionCode(code: number): Uint8Array {
  const strings = concat(utf16("manifest"), utf16("versionCode"));
  const pool = concat(
    u16(0x0001),
    u16(28),
    u32(28 + 8 + strings.length),
    u32(2),
    u32(0),
    u32(0),
    u32(36),
    u32(0),
    u32(0),
    u32(utf16("manifest").length),
    strings
  );
  const attr = concat(
    u32(0xffffffff),
    u32(1),
    u32(0xffffffff),
    u16(8),
    new Uint8Array([0, 0x10]),
    u32(code)
  );
  const element = concat(
    u16(0x0102),
    u16(16),
    u32(16 + 20 + attr.length),
    u32(1),
    u32(0xffffffff),
    u32(0xffffffff),
    u32(0),
    u16(20),
    u16(20),
    u16(1),
    u16(0),
    u16(0),
    u16(0),
    attr
  );
  const body = concat(pool, element);
  return concat(u16(0x0003), u16(8), u32(8 + body.length), body);
}

function zipStored(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
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
    u16(nameBytes.length),
    u16(0),
    nameBytes,
    data
  );
  const central = concat(
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
    u16(nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    nameBytes
  );
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(local.length),
    u16(0)
  );
  return concat(local, central, eocd);
}

describe("apk version code", () => {
  it("reads versionCode from a stored manifest", async () => {
    const xml = manifestWithVersionCode(10002);
    expect(versionCodeFromBinaryXml(xml)).toBe("10002");
    expect(await apkVersionCodeFromZipBytes(zipStored("AndroidManifest.xml", xml))).toBe(
      "10002"
    );
  });

  it("reads versionCode from a deflated manifest", async () => {
    const xml = manifestWithVersionCode(42);
    const deflated = deflateRawSync(xml);
    const name = new TextEncoder().encode("AndroidManifest.xml");
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(0),
      u32(deflated.length),
      u32(xml.length),
      u16(name.length),
      u16(0),
      name,
      deflated
    );
    const central = concat(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(0),
      u32(deflated.length),
      u32(xml.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(0),
      name
    );
    const eocd = concat(
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(1),
      u16(1),
      u32(central.length),
      u32(local.length),
      u16(0)
    );
    expect(
      await apkVersionCodeFromZipBytes(concat(local, central, eocd))
    ).toBe("42");
  });

  it("reads the published gittr 1.0.2 apk when the file is on disk", async () => {
    const path = "/tmp/gittr-1.0.2.apk";
    if (!existsSync(path)) return;
    const bytes = new Uint8Array(readFileSync(path));
    expect(await apkVersionCodeFromZipBytes(bytes)).toBe("10002");
  });
});
