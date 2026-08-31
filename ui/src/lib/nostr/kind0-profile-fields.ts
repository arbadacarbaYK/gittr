/**
 * Kind 0 profile name fields.
 *
 * NIP-01 uses snake_case `name` + `display_name`. Some clients (Primal, a few
 * Android apps) also write camelCase `displayName`. We treat all three as the
 * same card before falling back to npub.
 */

function asTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
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
  const names = normalizeKind0NameFields(raw);
  return {
    ...raw,
    ...(names.name ? { name: names.name } : {}),
    ...(names.display_name ? { display_name: names.display_name } : {}),
  };
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
  if (!raw || raw === "Anonymous Nostrich") return null;
  if (raw.startsWith("npub")) return null;
  if (/^[0-9a-f]{8,64}$/i.test(raw)) return null;
  return raw;
}
