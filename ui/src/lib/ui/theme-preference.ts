/** Theme shown until someone picks one in Appearance. */
export const DEFAULT_GITTR_THEME = "tokyo";

export const GITTR_THEME_STORAGE_KEY = "gittr_theme";
/** Set only when the visitor chooses a theme. Visiting the site does not count. */
export const GITTR_THEME_EXPLICIT_KEY = "gittr_theme_explicit";

export const GITTR_THEME_IDS = [
  "tokyo",
  "midnight",
  "bitcoin",
  "classic",
  "cypherpunk",
  "girly",
  "arcade80s",
] as const;

/**
 * Midnight and classic were written for everyone who had not chosen a theme.
 * Any other saved id was a real Appearance selection from before this flag existed.
 */
const LEGACY_UNDECIDED = new Set([
  "",
  "midnight",
  "classic",
  "null",
  "undefined",
]);

function isKnownTheme(theme: string): boolean {
  return (GITTR_THEME_IDS as readonly string[]).includes(theme);
}

/**
 * Tokyo unless the visitor decided otherwise.
 * Signed-out and signed-in visitors share this rule: login does not pick a theme.
 */
export function resolveGittrTheme(
  stored: string | null | undefined,
  explicit: string | null | undefined
): string {
  const theme = (stored || "").trim();
  if (explicit === "1" && isKnownTheme(theme)) return theme;
  if (theme && isKnownTheme(theme) && !LEGACY_UNDECIDED.has(theme)) {
    return theme;
  }
  return DEFAULT_GITTR_THEME;
}

/** Runs before paint. Must stay in step with resolveGittrTheme. */
export function gittrThemeBootScript(): string {
  const known = GITTR_THEME_IDS.map((id) => `${id}:1`).join(",");
  return `(function(){
    var DEFAULT_THEME=${JSON.stringify(DEFAULT_GITTR_THEME)};
    var KNOWN={${known}};
    function apply(theme){
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.classList.add('dark');
      if (document.body) document.body.setAttribute('data-theme', theme);
    }
    try {
      var stored = localStorage.getItem(${JSON.stringify(
        GITTR_THEME_STORAGE_KEY
      )});
      var explicit = localStorage.getItem(${JSON.stringify(
        GITTR_THEME_EXPLICIT_KEY
      )});
      var theme = (stored || '').trim();
      var chosen = explicit === '1' && KNOWN[theme];
      var legacyChoice = theme && KNOWN[theme] && theme !== 'midnight' && theme !== 'classic' && theme !== 'null' && theme !== 'undefined';
      apply(chosen || legacyChoice ? theme : DEFAULT_THEME);
    } catch (e) {
      apply(DEFAULT_THEME);
    }
  })();`;
}
