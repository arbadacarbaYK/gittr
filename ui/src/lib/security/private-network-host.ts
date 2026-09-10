/**
 * Client-safe private / LAN / Tailscale host checks (no Node DNS).
 *
 * Used to keep the public website from dialing WebSockets or HTTP to
 * machines on the visitor's local network (Chrome "local network access").
 */

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254",
]);

const PRIVATE_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".corp",
  ".private",
  // Tailscale MagicDNS — resolves to CGNAT 100.64/10 on the visitor's machine
  ".ts.net",
];

function isCgnatIpv4(hostname: string): boolean {
  const m = hostname.match(/^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octet = Number(m[1]);
  return octet >= 64 && octet <= 127;
}

/** True for loopback, RFC1918, link-local, ULA, CGNAT (Tailscale), mapped IPv6. */
export function isPrivateOrLocalIp(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr) return true;
  if (addr === "::1" || addr === "0.0.0.0") return true;
  if (addr.startsWith("127.")) return true;
  if (/^10\./.test(addr)) return true;
  if (/^192\.168\./.test(addr)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) return true;
  if (/^169\.254\./.test(addr)) return true;
  if (isCgnatIpv4(addr)) return true;
  if (/^fe80:/i.test(addr) || /^f[cd][0-9a-f]{2}:/i.test(addr)) return true;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return isPrivateOrLocalIp(mapped[1]);
  return false;
}

/**
 * True when this hostname should never be auto-dialed from gittr.space
 * (LAN, mDNS, Tailscale, cloud metadata).
 */
export function hostnameLooksPrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (METADATA_HOSTS.has(h)) return true;
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]") {
    return true;
  }
  if (PRIVATE_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (isCgnatIpv4(h)) return true;
  const bare = h.replace(/^\[|\]$/g, "");
  if (/^fe80:/i.test(bare) || /^f[cd][0-9a-f]{2}:/i.test(bare)) return true;
  return false;
}

/** Parse ws/wss/http/https (or bare host) and check the hostname. */
export function urlLooksPrivateOrLocal(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t) return true;
  try {
    const withProto = /:\/\//.test(t) ? t : `wss://${t}`;
    return hostnameLooksPrivateOrLocal(new URL(withProto).hostname);
  } catch {
    return true;
  }
}

/**
 * Public websites (gittr.space) must not open sockets to the visitor's LAN.
 * Local/self-hosted gittr (localhost, *.local, RFC1918) may still dial home relays.
 */
export function shouldFilterPrivateRelaysInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !hostnameLooksPrivateOrLocal(window.location.hostname);
  } catch {
    return true;
  }
}

/** Drop LAN / Tailscale URLs when the page is a public site. */
export function filterPrivateNetworkRelaysForPublicSite(
  relays: string[]
): string[] {
  if (!relays?.length) return relays || [];
  if (!shouldFilterPrivateRelaysInBrowser()) return relays;
  return omitHomeLanRelayUrls(relays);
}

/**
 * Strip home/LAN/Tailscale URLs. Public GRASP (ngit, shakespeare, nostrhub, …)
 * is never removed — only localhost, *.local, RFC1918, Tailscale.
 * Use for untrusted NIP-34 `relays` tags and for what gittr itself publishes.
 */
export function omitHomeLanRelayUrls(urls: string[]): string[] {
  if (!urls?.length) return [];
  return urls.filter((url) => {
    const t = String(url || "").trim();
    if (!t) return false;
    return !urlLooksPrivateOrLocal(t);
  });
}
