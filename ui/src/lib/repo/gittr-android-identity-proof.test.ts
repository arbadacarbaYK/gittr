import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { verifyApkIdentityProofEvent } from "../nostr/nip-c1-proof";

import {
  GITTR_CI_CERT_SHA256,
  signGittrCiIdentityProof,
} from "./gittr-android-identity-proof";

describe("gittr CI identity proof", () => {
  it("signs a proof the APK certificate accepts", async () => {
    const createdAt = Math.floor(Date.now() / 1000);
    const proof = signGittrCiIdentityProof({
      pubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      createdAt,
    });
    expect(proof.certificateHash).toBe(GITTR_CI_CERT_SHA256);
    const der = Uint8Array.from(
      Buffer.from(proof.certificateDerBase64, "base64")
    );
    const check = await verifyApkIdentityProofEvent({
      event: {
        kind: 30509,
        pubkey: GITTR_OWNER_PUBKEY_HEX,
        created_at: proof.createdAt,
        content: "",
        tags: [
          ["d", proof.certificateHash],
          ["signature", proof.signatureBase64],
          ["expiry", String(proof.expiry)],
          ["cert", proof.certificateDerBase64],
        ],
      },
      certificateDer: der,
      signerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      now: createdAt,
    });
    expect(check).toEqual({ ok: true, expiresAt: proof.expiry });
  });

  it("refuses to bind the certificate to another Nostr key", () => {
    expect(() =>
      signGittrCiIdentityProof({
        pubkeyHex: "ab".repeat(32),
        createdAt: Math.floor(Date.now() / 1000),
      })
    ).toThrow(/gittr publisher/);
  });
});
