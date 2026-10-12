import { describe, expect, it } from "vitest";

import {
  DEFAULT_GITTR_THEME,
  gittrThemeBootScript,
  resolveGittrTheme,
} from "./theme-preference";

function boot(stored: string | null, explicit: string | null): string {
  const localStorage = {
    getItem(key: string) {
      if (key === "gittr_theme") return stored;
      if (key === "gittr_theme_explicit") return explicit;
      return null;
    },
  };
  let applied = "";
  const document = {
    documentElement: {
      setAttribute(_name: string, value: string) {
        applied = value;
      },
      classList: { add() {} },
    },
    body: {
      setAttribute() {},
    },
  };
  // eslint-disable-next-line no-new-func
  new Function("localStorage", "document", gittrThemeBootScript())(
    localStorage,
    document
  );
  return applied;
}

describe("resolveGittrTheme", () => {
  it("uses Tokyo when nothing is stored", () => {
    expect(resolveGittrTheme(null, null)).toBe("tokyo");
    expect(boot(null, null)).toBe("tokyo");
  });

  it("treats the old automatic midnight default as undecided", () => {
    expect(resolveGittrTheme("midnight", null)).toBe(DEFAULT_GITTR_THEME);
    expect(boot("midnight", null)).toBe("tokyo");
    expect(resolveGittrTheme("classic", null)).toBe("tokyo");
  });

  it("keeps a theme the visitor actually chose", () => {
    expect(resolveGittrTheme("midnight", "1")).toBe("midnight");
    expect(boot("bitcoin", "1")).toBe("bitcoin");
    expect(resolveGittrTheme("bitcoin", null)).toBe("bitcoin");
    expect(boot("girly", null)).toBe("girly");
  });

  it("ignores an explicit flag for an unknown theme", () => {
    expect(resolveGittrTheme("nope", "1")).toBe("tokyo");
    expect(boot("nope", "1")).toBe("tokyo");
  });
});
