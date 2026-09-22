/**
 * Kind 0 profile name fields.
 *
 * NIP-01 uses snake_case `name` + `display_name`. Some clients (Primal, a few
 * Android apps) also write camelCase `displayName`. We treat all three as the
 * same card before falling back to npub.
 */

/** Kind-0 text that cards call `.trim()` on. Non-strings are dropped, not coerced. */
const KIND0_TEXT_FIELDS = [
  "nip05",
  "picture",
  "banner",
  "website",
  "about",
  "lud16",
  "lnurl",
  "nwcRecv",
] as const;

/**
 * NIP-01 says these fields are strings. Some clients publish a number, boolean,
 * array, or object. `value?.trim()` only skips null/undefined, so a bad `nip05`
 * used to white-screen `/apps` (`nip05.trim is not a function`).
 */
export function trimmedKind0String(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asTrimmedString(value: unknown): string {
  return trimmedKind0String(value);
}

export type Kind0NameSource = {
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
};

/** Copy camelCase `displayName` onto `display_name` when the NIP-01 field is empty. */
export function normalizeKind0NameFields(
  raw: Kind0NameSource | null | undefined
): {
  name?: string;
  display_name?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const name = asTrimmedString(raw.name);
  const display_name =
    asTrimmedString(raw.display_name) || asTrimmedString(raw.displayName);
  const out: { name?: string; display_name?: string } = {};
  if (name) out.name = name;
  if (display_name) out.display_name = display_name;
  return out;
}

export function applyKind0NameFields<T extends Kind0NameSource>(
  raw: T
): T & { name?: string; display_name?: string } {
  if (!raw || typeof raw !== "object") return raw;
  const names = normalizeKind0NameFields(raw);
  const next = { ...raw } as Record<string, unknown>;
  for (const key of KIND0_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const value = next[key];
    if (typeof value !== "string") {
      delete next[key];
      continue;
    }
    next[key] = value.trim();
  }
  if (names.name) next.name = names.name;
  else if (typeof next.name !== "string") delete next.name;
  if (names.display_name) next.display_name = names.display_name;
  else if (typeof next.display_name !== "string") delete next.display_name;
  return next as T & { name?: string; display_name?: string };
}

/**
 * Human label for a profile card. Empty / npub / hex / "Anonymous Nostrich"
 * are not names — callers should fall back to a short npub.
 */
export function pickProfileDisplayName(
  meta: Kind0NameSource | null | undefined
): string | null {
  const { name, display_name } = normalizeKind0NameFields(meta);
  const raw = (display_name || name || "").trim();
  if (!raw || isNpubOrHexStub(raw)) return null;
  return raw;
}

/** True for empty / npub / hex / "Anonymous Nostrich" — not a profile handle. */
export function isNpubOrHexStub(value: string | null | undefined): boolean {
  const raw = (value || "").trim();
  if (!raw || raw === "Anonymous Nostrich") return true;
  if (raw.startsWith("npub")) return true;
  if (/^[0-9a-f]{8,64}$/i.test(raw)) return true;
  return false;
}

/**
 * NIP-01 `name` (the handle) for Profile Settings. Never the session npub fallback.
 */
export function profileHandleFromMetadata(
  meta: Kind0NameSource | null | undefined
): string {
  const { name } = normalizeKind0NameFields(meta);
  if (!name || isNpubOrHexStub(name)) return "";
  return name;
}
