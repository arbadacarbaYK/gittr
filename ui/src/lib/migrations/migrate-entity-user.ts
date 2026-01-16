import useSession from "@/lib/nostr/useSession";

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[_-]+/g, "_") // Collapse multiple underscores/hyphens into single underscore
    .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
  return slug || "";
}

/**
 * Migrates all repos with entity "user" to use the actual Nostr username
 * This fixes the issue where all repos were using "user" as the entity
 */
export function migrateEntityUser(
  userName: string | null,
  isLoggedIn: boolean
): boolean {
  if (
    !isLoggedIn ||
    !userName ||
    userName === "Anonymous Nostrich" ||
    userName.trim() === ""
  ) {
    return false; // Cannot migrate without a valid username
  }

  try {
    const repos = JSON.parse(
      localStorage.getItem("gittr_repos") || "[]"
    ) as any[];
    let updated = false;

    const entitySlug = slugify(userName.trim());
    if (!entitySlug) {
      return false; // Invalid username slug
    }

    const migratedRepos = repos.map((r) => {
      // If entity is missing or "user", migrate it
      if (!r.entity || r.entity === "user") {
        updated = true;
        return {
          ...r,
          entity: entitySlug,
          entityDisplayName: userName,
        };
      }
      return r;
    });

    if (updated) {
      try {
        localStorage.setItem("gittr_repos", JSON.stringify(migratedRepos));
        console.log(
          `Migrated ${
            migratedRepos.filter((r) => r.entity === entitySlug).length
          } repos to use entity "${entitySlug}"`
        );
        return true;
      } catch (storageError: any) {
        if (
          storageError.name === "QuotaExceededError" ||
          storageError.code === 22
        ) {
          return false;
        }
        throw storageError; // Re-throw if it's a different error
      }
    }
  } catch (e: any) {
    if (e.name === "QuotaExceededError" || e.code === 22) {
      return false;
    }
    console.error("Failed to migrate entity user:", e);
  }

  return false;
}
