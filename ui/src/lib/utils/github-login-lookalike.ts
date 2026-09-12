/**
 * GitHub maps `{login}@users.noreply.github.com` to that login.
 * Using a shorter cousin of your real username (arbadacarba vs arbadacarbaYK)
 * makes GitHub list a stranger as a contributor. We hide that lookalike.
 */
export const MIN_GITHUB_LOOKALIKE_PREFIX = 8;

export function normalizeGithubLogin(login: string | null | undefined): string {
  return typeof login === "string" ? login.trim().toLowerCase() : "";
}

/** True when `candidate` is a proper prefix of `canonical` (noreply collision). */
export function githubLoginIsOwnerLookalike(
  candidateLogin: string | null | undefined,
  canonicalLogin: string | null | undefined
): boolean {
  const candidate = normalizeGithubLogin(candidateLogin);
  const canonical = normalizeGithubLogin(canonicalLogin);
  if (!candidate || !canonical || candidate === canonical) return false;
  if (candidate.length < MIN_GITHUB_LOOKALIKE_PREFIX) return false;
  return canonical.startsWith(candidate);
}

export function isGithubNoreplyLookalikeOfAny(
  candidateLogin: string | null | undefined,
  canonicalLogins: Iterable<string | null | undefined>
): boolean {
  for (const canonical of canonicalLogins) {
    if (githubLoginIsOwnerLookalike(candidateLogin, canonical)) return true;
  }
  return false;
}
