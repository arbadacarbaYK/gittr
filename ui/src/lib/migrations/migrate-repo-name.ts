/**
 * Migration: Ensure all repos have `name`, `repo`, and `slug` fields
 * 
 * This migration fixes repos that are missing these fields by:
 * 1. Ensuring `name` is set (from `repoData.name`, `repo`, `slug`, or `repositoryName`)
 * 2. Ensuring `repo` is set (from `slug`, `name`, or `repositoryName`)
 * 3. Ensuring `slug` is set (from `repo`, `name`, or `repositoryName`)
 * 4. All three fields should be consistent for proper display and URL generation
 */

export function migrateRepoName(): number {
  if (typeof window === "undefined") return 0;
  
  try {
    const reposJson = localStorage.getItem("gittr_repos");
    if (!reposJson) return 0;
    
    const repos = JSON.parse(reposJson);
    if (!Array.isArray(repos)) return 0;
    
    let migratedCount = 0;
    
    for (const repo of repos) {
      let needsMigration = false;
      
      // Find the best value for repo name/slug from various sources
      // Check all available fields to find the best value
      let repoValue: string | undefined;
      
      // Priority 1: Use repositoryName from Nostr event (if available)
      if (repo.repositoryName && typeof repo.repositoryName === "string" && repo.repositoryName.trim().length > 0) {
        repoValue = repo.repositoryName.trim();
      }
      // Priority 2: Use repo field
      else if (repo.repo && typeof repo.repo === "string" && repo.repo.trim().length > 0) {
        repoValue = repo.repo.trim();
      }
      // Priority 3: Use slug field
      else if (repo.slug && typeof repo.slug === "string" && repo.slug.trim().length > 0) {
        repoValue = repo.slug.trim();
      }
      // Priority 4: Use name field (might be human-readable, but better than nothing)
      else if (repo.name && typeof repo.name === "string" && repo.name.trim().length > 0 && repo.name !== "Unnamed Repository") {
        repoValue = repo.name.trim();
      }
      // Priority 5: Extract from entity/repo path if available (unlikely for npub, but check anyway)
      else if (repo.entity && typeof repo.entity === "string") {
        const parts = repo.entity.split("/");
        if (parts.length > 1) {
          repoValue = parts[parts.length - 1].trim();
        }
      }
      
      // If we found a value, ensure all three fields are set
      if (repoValue && repoValue.length > 0) {
        // Set name if missing or invalid
        if (!repo.name || typeof repo.name !== "string" || repo.name.trim().length === 0 || repo.name === "Unnamed Repository") {
          repo.name = repoValue;
          needsMigration = true;
        }
        
        // Always ensure repo field is set (even if name exists, repo might be missing)
        if (!repo.repo || typeof repo.repo !== "string" || repo.repo.trim().length === 0) {
          repo.repo = repoValue;
          needsMigration = true;
        }
        
        // Always ensure slug field is set (even if name/repo exist, slug might be missing)
        if (!repo.slug || typeof repo.slug !== "string" || repo.slug.trim().length === 0) {
          repo.slug = repoValue;
          needsMigration = true;
        }
      } else {
        // Last resort: use a default value
        console.warn("⚠️ [Migration] Repo missing name fields, using defaults:", {
          entity: repo.entity,
          repo: repo.repo,
          slug: repo.slug,
          name: repo.name,
          repositoryName: repo.repositoryName,
        });
        const defaultValue = "unnamed-repo";
        if (!repo.name || repo.name === "Unnamed Repository") {
          repo.name = "Unnamed Repository";
          needsMigration = true;
        }
        if (!repo.repo || typeof repo.repo !== "string" || repo.repo.trim().length === 0) {
          repo.repo = defaultValue;
          needsMigration = true;
        }
        if (!repo.slug || typeof repo.slug !== "string" || repo.slug.trim().length === 0) {
          repo.slug = defaultValue;
          needsMigration = true;
        }
      }
      
      if (needsMigration) {
        migratedCount++;
      }
    }
    
    // Save migrated repos back to localStorage
    if (migratedCount > 0) {
      try {
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
      } catch (storageError: any) {
        if (storageError.name === "QuotaExceededError" || storageError.code === 22) {
          return 0; // Return 0 to indicate migration didn't complete
        }
        throw storageError; // Re-throw if it's a different error
      }
    }
    
    return migratedCount;
  } catch (error: any) {
    // Check if it's a QuotaExceededError that wasn't caught above
    if (error.name === "QuotaExceededError" || error.code === 22) {
      return 0;
    }
    console.error("❌ [Migration] Failed to migrate repo names:", error);
    return 0;
  }
}

