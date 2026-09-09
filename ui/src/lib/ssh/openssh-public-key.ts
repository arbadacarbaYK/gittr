export const SSH_PUBLIC_KEY_TYPES = [
  "ssh-rsa",
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
] as const;

export type SshPublicKeyType = (typeof SSH_PUBLIC_KEY_TYPES)[number];

export function isSshPublicKeyType(value: string): value is SshPublicKeyType {
  return (SSH_PUBLIC_KEY_TYPES as readonly string[]).includes(value);
}

export function parseSshPublicKeyLine(input: string): {
  keyType: SshPublicKeyType;
  body: string;
  comment: string;
} | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  if (!isSshPublicKeyType(parts[0])) return null;
  return {
    keyType: parts[0],
    body: parts[1],
    comment: parts.slice(2).join(" "),
  };
}

/** Type + key body, ignoring the comment — used to dedupe keys. */
export function sshKeyBody(publicKey: string): string {
  const parsed = parseSshPublicKeyLine(publicKey);
  if (!parsed) return publicKey.trim();
  return `${parsed.keyType} ${parsed.body}`;
}

export function sshKeyFingerprintHint(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  const body = parts[1] || publicKey;
  if (body.length < 16) return body;
  return `${body.slice(0, 8)}…${body.slice(-8)}`;
}

/**
 * OpenSSH line for kind-52 content. Matches the old Settings / createSSHKeyEvent
 * rules: append title only when the paste had no comment; otherwise keep the
 * pasted line; invent a fallback comment when neither is present.
 */
export function formatSshKeyContent(
  publicKey: string,
  options?: { title?: string; fallbackTitle?: string }
): { keyType: SshPublicKeyType; keyContent: string; title: string } {
  const trimmed = publicKey.trim();
  const parts = trimmed.split(/\s+/);
  const parsed = parseSshPublicKeyLine(trimmed);
  if (!parsed) {
    if (parts.length >= 2 && parts[0] && !isSshPublicKeyType(parts[0])) {
      throw new Error(
        `Invalid key type: ${parts[0]}. Supported: ${SSH_PUBLIC_KEY_TYPES.join(
          ", "
        )}`
      );
    }
    throw new Error(
      "Invalid SSH key format. Expected: <key-type> <public-key> [title]"
    );
  }

  const formTitle = options?.title?.trim() || "";
  const fallback = options?.fallbackTitle?.trim() || `gittr-${Date.now()}`;
  let keyContent = trimmed;
  if (formTitle && !parsed.comment) {
    keyContent = `${parsed.keyType} ${parsed.body} ${formTitle}`;
  } else if (!formTitle && !parsed.comment) {
    keyContent = `${parsed.keyType} ${parsed.body} ${fallback}`;
  }

  return {
    keyType: parsed.keyType,
    keyContent,
    title: formTitle || parsed.comment || fallback,
  };
}
