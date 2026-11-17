/**
 * Sign Zapstore's NIP-C1 proof (kind 30509) with gittr's public CI certificate.
 * The APKs on GitHub Releases are signed with this same key. The Nostr event
 * is still signed by the publisher in the browser; this only produces the
 * certificate signature. Other people's keystores are not here.
 */
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { apkIdentityProofMessage } from "../nostr/nip-c1-proof";

import { GITTR_CI_CERT_SHA256 } from "./gittr-android-app";

export { GITTR_CI_CERT_SHA256 };

/** How long a freshly signed proof stays valid. Kind 30509 can be replaced. */
export const GITTR_IDENTITY_PROOF_TTL_SECONDS = 365 * 24 * 60 * 60;

const KEYSTORE_PASSWORD = "gittr-android-ci";

export type GittrIdentityProofMaterial = {
  createdAt: number;
  expiry: number;
  certificateHash: string;
  signatureBase64: string;
  certificateDerBase64: string;
};

function keystorePath(): string {
  const candidates = [
    path.resolve(process.cwd(), "../android-app/keystore/gittr-ci.p12"),
    path.resolve(process.cwd(), "android-app/keystore/gittr-ci.p12"),
    "/opt/ngit/android-app/keystore/gittr-ci.p12",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "gittr’s signing certificate is not available on this server."
    );
  }
  return found;
}

let cached: { keyPem: string; certDer: Buffer } | null = null;

function loadCiKey(): { keyPem: string; certDer: Buffer } {
  if (cached) return cached;
  const pem = execFileSync(
    "openssl",
    [
      "pkcs12",
      "-in",
      keystorePath(),
      "-nodes",
      "-passin",
      `pass:${KEYSTORE_PASSWORD}`,
    ],
    { encoding: "utf8" }
  );
  const key = pem.match(
    /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/
  );
  const cert = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
  );
  if (!key || !cert) {
    throw new Error("gittr’s signing certificate could not be read.");
  }
  const certDer = execFileSync("openssl", ["x509", "-outform", "DER"], {
    input: cert[0],
  });
  cached = { keyPem: key[0], certDer };
  return cached;
}

export function signGittrCiIdentityProof(args: {
  pubkeyHex: string;
  createdAt: number;
}): GittrIdentityProofMaterial {
  const pubkey = args.pubkeyHex.trim().toLowerCase();
  if (pubkey !== GITTR_OWNER_PUBKEY_HEX) {
    throw new Error("This ownership proof is only for the gittr publisher.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(args.createdAt) ||
    Math.abs(args.createdAt - now) > 180
  ) {
    throw new Error("The proof time is out of date. Publish again.");
  }
  const expiry = args.createdAt + GITTR_IDENTITY_PROOF_TTL_SECONDS;
  const message = apkIdentityProofMessage({
    createdAt: args.createdAt,
    expiry,
    pubkeyHex: pubkey,
  });
  const { keyPem, certDer } = loadCiKey();
  const signature = createSign("RSA-SHA256").update(message).end().sign(keyPem);
  return {
    createdAt: args.createdAt,
    expiry,
    certificateHash: GITTR_CI_CERT_SHA256,
    signatureBase64: signature.toString("base64"),
    certificateDerBase64: certDer.toString("base64"),
  };
}
