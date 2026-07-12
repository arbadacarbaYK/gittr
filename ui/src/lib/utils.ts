import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const enum LoginType {
  default,
  hex,
  npub,
  nip05,
  nip07,
}

const regexMap: { [key: string]: LoginType } = {
  [/^npub[0-3][qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/i.source]: LoginType.npub,
  [/^[a-fA-F0-9]{64}$/i.source]: LoginType.hex,
  [/^[a-z0-9\-\_\.]+@[a-zA-Z_]+?(\.[a-zA-Z]{1,16})+?$/i.source]:
    LoginType.nip05,
};

export function checkType(str: string): LoginType {
  let type = LoginType.default;
  Object.keys(regexMap).forEach((regex) => {
    if (new RegExp(regex).test(str)) {
      type = regexMap[regex] || LoginType.default;
    }
  });
  return type;
}

export function isRemoteSignerUri(str: string): boolean {
  const t = str.trim();
  return t.startsWith("bunker://") || t.startsWith("nostrconnect://");
}

/** Collapse accidental newlines/spaces from mobile paste. */
export function normalizePastedRemoteToken(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}
