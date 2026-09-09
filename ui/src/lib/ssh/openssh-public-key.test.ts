import { describe, expect, it } from "vitest";

import {
  formatSshKeyContent,
  parseSshPublicKeyLine,
  sshKeyBody,
  sshKeyFingerprintHint,
} from "./openssh-public-key";

const SAMPLE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISampleKeyBodyNotRealAAAA gittr-laptop";

describe("openssh public key helpers", () => {
  it("parses type, body, and comment", () => {
    expect(parseSshPublicKeyLine(SAMPLE)).toEqual({
      keyType: "ssh-ed25519",
      body: "AAAAC3NzaC1lZDI1NTE5AAAAISampleKeyBodyNotRealAAAA",
      comment: "gittr-laptop",
    });
  });

  it("rejects unknown key types", () => {
    expect(() =>
      formatSshKeyContent("ssh-dss AAAAB3NzaC1kc3MAAAA comment")
    ).toThrow(/Invalid key type: ssh-dss/);
  });

  it("rejects a bare token", () => {
    expect(() => formatSshKeyContent("not-a-key")).toThrow(
      /Invalid SSH key format/
    );
  });

  it("appends a form title only when the paste has no comment", () => {
    const line =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISampleKeyBodyNotRealAAAA";
    expect(
      formatSshKeyContent(line, { title: "My Laptop", fallbackTitle: "unused" })
    ).toEqual({
      keyType: "ssh-ed25519",
      keyContent: `${line} My Laptop`,
      title: "My Laptop",
    });
  });

  it("keeps an existing comment and prefers the form title for display", () => {
    expect(
      formatSshKeyContent(SAMPLE, {
        title: "Override",
        fallbackTitle: "unused",
      })
    ).toEqual({
      keyType: "ssh-ed25519",
      keyContent: SAMPLE,
      title: "Override",
    });
  });

  it("invents a fallback comment when neither title nor paste comment exists", () => {
    const line =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISampleKeyBodyNotRealAAAA";
    expect(
      formatSshKeyContent(line, { fallbackTitle: "gittr-space-1" })
    ).toEqual({
      keyType: "ssh-ed25519",
      keyContent: `${line} gittr-space-1`,
      title: "gittr-space-1",
    });
  });

  it("dedupes on type + body, ignoring the comment", () => {
    expect(sshKeyBody(SAMPLE)).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISampleKeyBodyNotRealAAAA"
    );
  });

  it("shows a short fingerprint hint", () => {
    expect(sshKeyFingerprintHint(SAMPLE)).toBe("AAAAC3Nz…RealAAAA");
  });
});
