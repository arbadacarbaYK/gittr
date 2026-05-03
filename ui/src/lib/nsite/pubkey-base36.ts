/**
 * NIP-5A canonical host labels: 32-byte pubkey encoded in base36, lowercase,
 * exactly 50 characters (leading zeros).
 */
export function pubkeyHexToPubkeyB36(pubkeyHex: string): string {
  const h = pubkeyHex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) {
    return "";
  }
  let n = BigInt(`0x${h}`);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const zero = BigInt(0);
  const thirtySix = BigInt(36);
  if (n === zero) {
    return "0".repeat(50);
  }
  let out = "";
  while (n > zero) {
    const rem = Number(n % thirtySix);
    out = alphabet[rem] + out;
    n = n / thirtySix;
  }
  return out.padStart(50, "0");
}
