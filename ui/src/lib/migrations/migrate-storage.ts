"use client";

/**
 * Migrates legacy ngit* localStorage keys/custom values to the new gittr* names.
 * This prevents existing users from losing cached data after the rebrand.
 */
export function migrateLegacyLocalStorage() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }

  try {
    // Avoid running more than once per session
    if (localStorage.getItem("gittr_storage_migrated_v1")) {
      return;
    }

    const renameKey = (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      const value = localStorage.getItem(oldKey);
      if (value === null) return;
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(oldKey);
    };

    const renamePrefix = (oldPrefix: string, newPrefix: string) => {
      const keysToRename: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(oldPrefix)) {
          keysToRename.push(key);
        }
      }
      keysToRename.forEach((key) => {
        const suffix = key.slice(oldPrefix.length);
        renameKey(key, `${newPrefix}${suffix}`);
      });
    };

    // Exact key mappings (safety net for keys without prefix pattern)
    const exactMappings: Record<string, string> = {
      ngitspace: "gittrspace",
      "ngit:encrypted:nostr:privkey": "gittr:encrypted:nostr:privkey",
    };

    Object.entries(exactMappings).forEach(([oldKey, newKey]) =>
      renameKey(oldKey, newKey)
    );

    // Generic prefix migrations
    renamePrefix("ngit_", "gittr_");
    renamePrefix("ngit:", "gittr:");

    localStorage.setItem("gittr_storage_migrated_v1", "true");
  } catch (error) {
    console.error("Failed to migrate legacy storage keys:", error);
  }
}
