/**
 * Migration utility to re-fetch files for repositories that were imported
 * before file fetching was properly implemented.
 *
 * This function checks localStorage for repos without files and triggers
 * a re-fetch from either Nostr events or git-nostr-bridge.
 */

export interface MigrationResult {
  totalRepos: number;
  reposWithoutFiles: number;
  reposMigrated: number;
  errors: Array<{ repo: string; error: string }>;
}

/**
 * Migrates repository files by re-fetching them from Nostr or git-nostr-bridge.
 *
 * @param subscribe - Nostr subscribe function
 * @param defaultRelays - Array of default relay URLs
 * @param onProgress - Optional progress callback
 * @returns Promise with migration results
 */
export async function migrateRepoFiles(
  subscribe: any,
  defaultRelays: string[],
  onProgress?: (message: string) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalRepos: 0,
    reposWithoutFiles: 0,
    reposMigrated: 0,
    errors: [],
  };

  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    result.totalRepos = repos.length;

    // Find repos without files
    const reposWithoutFiles = repos.filter((r: any) => {
      const hasFiles = r.files && Array.isArray(r.files) && r.files.length > 0;
      return !hasFiles;
    });

    result.reposWithoutFiles = reposWithoutFiles.length;
    onProgress?.(
      `Found ${reposWithoutFiles.length} repos without files to migrate`
    );

    // For each repo without files, try to fetch from Nostr first, then git-nostr-bridge
    for (const repo of reposWithoutFiles) {
      try {
        const ownerPubkey = repo.ownerPubkey;
        const repoName = repo.repo || repo.slug || repo.name;
        const entity = repo.entity;

        if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
          result.errors.push({
            repo: `${entity}/${repoName}`,
            error: "Missing or invalid ownerPubkey",
          });
          continue;
        }

        if (!repoName) {
          result.errors.push({
            repo: `${entity}/${repoName || "unknown"}`,
            error: "Missing repo name",
          });
          continue;
        }

        onProgress?.(`Migrating ${entity}/${repoName}...`);

        // FIRST: Try to fetch from Nostr events
        let foundFiles = false;
        const filesFromNostr = await new Promise<any[]>((resolve) => {
          if (!subscribe || !defaultRelays || defaultRelays.length === 0) {
            resolve([]);
            return;
          }

          const KIND_REPOSITORY = 51;
          const KIND_REPOSITORY_NIP34 = 30617;
          let unsub: (() => void) | undefined;
          let timeout: NodeJS.Timeout;

          unsub = subscribe(
            [
              {
                kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                authors: [ownerPubkey],
                "#d": [repoName],
                limit: 1,
              },
              {
                kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                authors: [ownerPubkey],
                limit: 10,
              },
            ],
            defaultRelays,
            (event: any, isAfterEose: boolean, relayURL: string) => {
              if (foundFiles) return;

              try {
                let eventRepoData: any;
                if (event.kind === KIND_REPOSITORY_NIP34) {
                  eventRepoData = { repositoryName: "" };
                  if (event.tags && Array.isArray(event.tags)) {
                    for (const tag of event.tags) {
                      if (
                        Array.isArray(tag) &&
                        tag.length >= 2 &&
                        tag[0] === "d"
                      ) {
                        eventRepoData.repositoryName = tag[1];
                      }
                    }
                  }
                  if (event.content) {
                    try {
                      const contentData = JSON.parse(event.content);
                      if (contentData.files)
                        eventRepoData.files = contentData.files;
                    } catch {}
                  }
                } else {
                  eventRepoData = JSON.parse(event.content);
                }

                const repoNameMatches =
                  eventRepoData.repositoryName &&
                  (eventRepoData.repositoryName.toLowerCase() ===
                    repoName.toLowerCase() ||
                    eventRepoData.repositoryName === repoName);
                const pubkeyMatches =
                  event.pubkey.toLowerCase() === ownerPubkey.toLowerCase();

                if (
                  (repoNameMatches || pubkeyMatches) &&
                  eventRepoData.files &&
                  Array.isArray(eventRepoData.files) &&
                  eventRepoData.files.length > 0
                ) {
                  foundFiles = true;
                  if (unsub) unsub();
                  if (timeout) clearTimeout(timeout);
                  resolve(eventRepoData.files);
                }
              } catch (e) {
                console.error("Error parsing Nostr event:", e);
              }
            },
            undefined,
            (events: any[], relayURL: string) => {
              if (!foundFiles) {
                if (unsub) unsub();
                if (timeout) clearTimeout(timeout);
                resolve([]);
              }
            }
          );

          timeout = setTimeout(() => {
            if (!foundFiles && unsub) {
              unsub();
              resolve([]);
            }
          }, 10000);
        });

        if (filesFromNostr && filesFromNostr.length > 0) {
          // Update the repo in localStorage
          const updated = repos.map((r: any) => {
            if (
              r === repo ||
              (r.entity === entity &&
                (r.repo === repoName || r.slug === repoName))
            ) {
              return { ...r, files: filesFromNostr };
            }
            return r;
          });
          localStorage.setItem("gittr_repos", JSON.stringify(updated));
          result.reposMigrated++;
          onProgress?.(
            `✅ Migrated ${entity}/${repoName} from Nostr: ${filesFromNostr.length} files`
          );
          continue; // Skip git-nostr-bridge if we got files from Nostr
        }

        // SECOND: Try to fetch from git-nostr-bridge API
        const branch = repo.defaultBranch || "main";
        const url = `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(
          ownerPubkey
        )}&repo=${encodeURIComponent(repoName)}&branch=${encodeURIComponent(
          branch
        )}`;

        const response = await fetch(url);
        const data = await response.json();

        if (
          response.ok &&
          data.files &&
          Array.isArray(data.files) &&
          data.files.length > 0
        ) {
          // Update the repo in localStorage
          const updated = repos.map((r: any) => {
            if (
              r === repo ||
              (r.entity === entity &&
                (r.repo === repoName || r.slug === repoName))
            ) {
              return { ...r, files: data.files };
            }
            return r;
          });
          localStorage.setItem("gittr_repos", JSON.stringify(updated));
          result.reposMigrated++;
          onProgress?.(
            `✅ Migrated ${entity}/${repoName} from git-nostr-bridge: ${data.files.length} files`
          );
        } else {
          result.errors.push({
            repo: `${entity}/${repoName}`,
            error:
              response.status === 404
                ? "Repository not found in git-nostr-bridge (empty bare repo)"
                : "No files returned",
          });
          onProgress?.(
            `⚠️ Could not migrate ${entity}/${repoName}: ${
              response.status === 404
                ? "repo exists but is empty (no commits pushed yet)"
                : "no files"
            }`
          );
        }
      } catch (error: any) {
        result.errors.push({
          repo: `${repo.entity}/${repo.repo || repo.slug || repo.name}`,
          error: error.message || "Unknown error",
        });
      }
    }

    onProgress?.(
      `Migration complete: ${result.reposMigrated}/${result.reposWithoutFiles} repos migrated`
    );
    return result;
  } catch (error: any) {
    console.error("❌ [Migration] Error during file migration:", error);
    return result;
  }
}
