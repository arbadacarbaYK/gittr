"use client";

import { Suspense, useEffect, useState } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { clearDeletedRepoTombstones } from "@/lib/repos/deleted-repo-tombstones";
import { githubParentForkedFrom } from "@/lib/repos/fork-attribution";
import {
  type ForkImportCandidate,
  gittrForkPointer,
  importApiForUrl,
  isGithubOwnerRepoShorthand,
  parseGittrRepoPointer,
  pickForkImportUrls,
  rewriteGittrWebUrlToGitRemote,
} from "@/lib/repos/fork-import-source";
import { fetchRepoCloneHintsFromProfile } from "@/lib/repos/hydrate-clone-from-profile-repos";
import {
  type StoredContributor,
  type StoredRepo,
  loadStoredRepos,
} from "@/lib/repos/storage";
import {
  isCloneableUpstreamSourceUrl,
  normalizeGitCloneUrl,
} from "@/lib/utils/detect-git-forge";
import { validateRepoForForkOrSign } from "@/lib/utils/repo-corruption-check";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { useRouter, useSearchParams } from "next/navigation";
import { nip19 } from "nostr-tools";

function slugify(text: string): string {
  // CRITICAL: Normalize repo names for NEW repos to URL-safe format
  // Use hyphens (kebab-case) instead of underscores for better URL readability
  // This ensures new repos have clean URLs, but imported repos preserve their original names
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-") // Replace spaces with hyphens (kebab-case)
    .replace(/[_-]+/g, "-") // Collapse multiple underscores/hyphens into single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
  // Never default to "user" - return the slug or empty string
  return slug || "";
}

function NewRepoPageContent() {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [readme, setReadme] = useState("");
  const [importing, setImporting] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { name: userName, isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  // If called as a fork (/new?fork=entity/repo), prefill and stage source
  const forkParam = searchParams?.get("fork") || "";
  const forkParts = forkParam.split("/").filter(Boolean);
  const forkEntity = forkParts[0] || "";
  const forkRepo = forkParts[1] || "";
  const [forkSource, setForkSource] = useState<StoredRepo | null>(null);
  const [forkHintsReady, setForkHintsReady] = useState(false);

  // Prefill name for forks and load source repo (localStorage + live clone/source)
  useEffect(() => {
    let cancelled = false;
    if (!forkEntity || !forkRepo) {
      setForkHintsReady(true);
      return;
    }
    void (async () => {
      let source: StoredRepo | null = null;
      try {
        const repos = loadStoredRepos();
        source =
          findRepoByEntityAndName<StoredRepo>(repos, forkEntity, forkRepo) ||
          null;
      } catch {
        /* ignore */
      }

      try {
        const hints = await fetchRepoCloneHintsFromProfile(
          forkEntity,
          forkRepo
        );
        if (hints && !cancelled) {
          source = {
            ...(source || {
              entity: forkEntity,
              repo: forkRepo,
              name: forkRepo,
            }),
            clone:
              hints.clone.length > 0 ? hints.clone : source?.clone || undefined,
            sourceUrl: hints.sourceUrl || source?.sourceUrl,
            description: source?.description,
          };
        }
      } catch {
        /* clone tags optional — inferred GRASP URLs still work */
      }

      if (cancelled) return;
      if (source) {
        setForkSource(source);
        setName((current) => {
          if (current) return current;
          const base = source.name || forkRepo;
          try {
            if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
              const myNpub = nip19.npubEncode(pubkey);
              const taken = findRepoByEntityAndName(
                loadStoredRepos(),
                myNpub,
                base
              );
              return taken ? `${base}-fork` : base;
            }
          } catch {
            /* keep base */
          }
          return base;
        });
        const sourceWithReadme = source as StoredRepo & { readme?: string };
        if (sourceWithReadme.readme) setReadme(sourceWithReadme.readme);
      } else {
        setForkSource({
          entity: forkEntity,
          repo: forkRepo,
          name: forkRepo,
        });
        setName((current) => current || forkRepo);
      }
      setForkHintsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [forkEntity, forkRepo, pubkey]);

  // Helper to get entity slug and display name - use Nostr pubkey, not username slug
  const getEntityInfo = () => {
    // Always use the logged-in user's Nostr pubkey for entity (npub format - GRASP protocol standard)
    if (!isLoggedIn || !pubkey || typeof pubkey !== "string") {
      throw new Error(
        "You must be logged in with Nostr key to create a repository"
      );
    }
    const pubkeyStr = String(pubkey); // Ensure it's a string
    if (!/^[0-9a-f]{64}$/i.test(pubkeyStr)) {
      throw new Error("Invalid pubkey format");
    }

    // CRITICAL: Never allow entity to be "gittr.space" or any domain name
    if (
      pubkeyStr.toLowerCase().includes("gittr") ||
      pubkeyStr.toLowerCase().includes("space")
    ) {
      throw new Error("Invalid pubkey: cannot use domain name as entity");
    }

    const displayName =
      userName && userName !== "Anonymous Nostrich" && userName.trim() !== ""
        ? userName.trim()
        : pubkeyStr.slice(0, 8);
    // CRITICAL: Use npub format for entity (GRASP protocol standard, matches URLs)
    let entityNpub: string;
    try {
      entityNpub = nip19.npubEncode(pubkeyStr);
    } catch (e) {
      throw new Error("Failed to encode npub");
    }

    // CRITICAL: Validate entity is not a domain name
    if (
      entityNpub.includes("gittr.space") ||
      (entityNpub.includes(".") && !entityNpub.startsWith("npub"))
    ) {
      throw new Error("Invalid entity: cannot use domain name as entity");
    }

    console.log("getEntityInfo:", {
      userName,
      isLoggedIn,
      displayName,
      entity: entityNpub,
      pubkey: pubkeyStr.slice(0, 8),
    });
    return { entitySlug: entityNpub, displayName };
  };

  function resolveImportCandidates(): ForkImportCandidate[] {
    const typedUrl = url.trim();
    if (typedUrl) {
      const pointer = parseGittrRepoPointer(typedUrl);
      const rewritten = rewriteGittrWebUrlToGitRemote(typedUrl);
      if (isGithubOwnerRepoShorthand(typedUrl)) {
        return [{ url: `https://github.com/${typedUrl}`, via: "forge-source" }];
      }
      if (pointer) {
        return pickForkImportUrls({
          sourceUrl: forkSource?.sourceUrl || rewritten,
          clone: [
            ...(Array.isArray(forkSource?.clone) ? forkSource.clone : []),
            ...(rewritten ? [rewritten] : []),
          ],
          forkEntity: pointer.entity,
          forkRepo: pointer.repo,
        });
      }
      if (rewritten) {
        return [{ url: rewritten, via: "clone" }];
      }
      const normalized = normalizeGitCloneUrl(typedUrl);
      return [
        {
          url: normalized,
          via:
            importApiForUrl(normalized) === "github" ? "forge-source" : "clone",
        },
      ];
    }
    if (forkEntity && forkRepo) {
      return pickForkImportUrls({
        sourceUrl: forkSource?.sourceUrl,
        clone: forkSource?.clone,
        forkEntity,
        forkRepo,
      });
    }
    return [];
  }

  async function postImportFromUrl(sourceUrl: string): Promise<{
    ok: boolean;
    d?: any;
    error?: string;
  }> {
    const normalized = normalizeGitCloneUrl(sourceUrl);
    const api = importApiForUrl(normalized);
    let r: Response;
    if (api === "github") {
      const githubToken =
        typeof window !== "undefined"
          ? localStorage.getItem("gittr_github_token")
          : null;
      r = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: normalized,
          ...(githubToken ? { githubToken } : {}),
        }),
      });
    } else {
      r = await fetch("/api/import-git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: normalized }),
      });
    }
    const rawText = await r.text();
    try {
      const d = JSON.parse(rawText);
      if (d.status === "completed" || d.success) {
        return { ok: true, d };
      }
      return {
        ok: false,
        d,
        error: d.message || d.status || `HTTP ${r.status}`,
      };
    } catch {
      return {
        ok: false,
        error: `HTTP ${r.status}: non-JSON response. ${rawText.slice(0, 180)}`,
      };
    }
  }

  async function submit() {
    setStatus("Working…");
    let entityInfo;
    try {
      entityInfo = getEntityInfo();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      return;
    }
    const isForkIntent = !!(forkEntity && forkRepo);
    const importCandidates = resolveImportCandidates();

    if (importCandidates.length > 0) {
      setImporting(true);
      try {
        let d: any = null;
        let used: ForkImportCandidate | null = null;
        let lastError = "";
        let normalizedUrl = "";

        for (const candidate of importCandidates) {
          setStatus(`Importing from ${candidate.url}…`);
          const result = await postImportFromUrl(candidate.url);
          if (result.ok && result.d) {
            d = result.d;
            used = candidate;
            normalizedUrl = candidate.url;
            break;
          }
          lastError = result.error || "Import failed";
        }

        if (d && used) {
          // Slugify the imported repo name to ensure URL-safe format.
          // Forks keep the name the user chose (parent name by default).
          const importedRepoSlug = slugify(
            isForkIntent ? name || d.repo || d.slug : d.repo || d.slug
          );
          if (!importedRepoSlug) {
            setStatus(
              `Import failed: Repository name "${
                d.repo || d.slug
              }" is not valid for URL`
            );
            return;
          }
          setStatus(`Imported ${entityInfo.entitySlug}/${importedRepoSlug}`);
          setReadme(d.readme || "");

          let importedFileCount = 0;
          // store repo locally for listing - always use current user's Nostr pubkey as entity
          try {
            const repos = JSON.parse(
              localStorage.getItem("gittr_repos") || "[]"
            );
            // For imports, use GitHub repo name but keep user's Nostr pubkey as entity
            const entity = entityInfo.entitySlug; // Use npub format (GRASP protocol standard)
            const repo = importedRepoSlug; // Use slugified version
            // Only treat as duplicate for the same entity+repo (never match slug alone:
            // another cached repo can share a slug under a different entity and would
            // incorrectly block imports).
            const duplicateIdx = repos.findIndex(
              (r: any) =>
                findRepoByEntityAndName<StoredRepo>([r], entity, repo) !==
                undefined
            );
            // Ensure current user (owner) is ALWAYS in contributors array with pubkey for icon resolution
            // GitHub contributors won't have pubkeys, but we add the current user as owner
            const contributors: Array<{
              pubkey?: string;
              name?: string;
              picture?: string;
              weight: number;
              githubLogin?: string;
            }> = [...(d.contributors || [])];

            // Always ensure owner is present (replace if exists, add if not)
            if (pubkey) {
              const existingOwnerIdx = contributors.findIndex(
                (c: any) => c.pubkey === pubkey
              );
              const ownerContributor = {
                pubkey,
                name: entityInfo.displayName,
                weight: 100,
              };
              if (existingOwnerIdx >= 0) {
                contributors[existingOwnerIdx] = ownerContributor; // Replace with owner weight
              } else {
                contributors.unshift(ownerContributor); // Add owner at the beginning
              }
            }

            // CRITICAL: Preserve original GitHub repo name (with dots) in 'name' field for display
            // Use slugified version for URLs (slug, repo, repositoryName)
            const originalRepoName = isForkIntent
              ? name || d.repo || d.slug || importedRepoSlug
              : d.repo || d.slug || name || importedRepoSlug;

            const parentForgeSource =
              forkSource?.sourceUrl &&
              isCloneableUpstreamSourceUrl(forkSource.sourceUrl)
                ? forkSource.sourceUrl
                : undefined;
            const importedForgeSource =
              used.via === "forge-source" &&
              isCloneableUpstreamSourceUrl(
                d.sourceUrl || d.htmlUrl || normalizedUrl
              )
                ? d.sourceUrl || d.htmlUrl || normalizedUrl
                : undefined;

            // CRITICAL: Validate entity is not a domain name or empty
            if (
              !entity ||
              entity === "gittr.space" ||
              (entity.includes(".") && !entity.startsWith("npub"))
            ) {
              setStatus(
                `Error: Invalid entity "${entity}". Repository not created.`
              );
              return;
            }

            // CRITICAL: Store files separately to avoid localStorage quota issues
            // Only store fileCount in repo object, not full files array
            let fileCount = 0;
            if (d.files && Array.isArray(d.files) && d.files.length > 0) {
              fileCount = d.files.length;
              importedFileCount = fileCount;
              try {
                const { saveRepoFiles } = await import("@/lib/repos/storage");
                saveRepoFiles(entity, importedRepoSlug, d.files);
                console.log(
                  `✅ [New Repo] Saved ${fileCount} files to separate storage for ${entity}/${importedRepoSlug}`
                );
              } catch (e: any) {
                console.error(
                  `❌ [New Repo] Failed to save files separately:`,
                  e
                );
                // Continue anyway - fileCount will be 0
              }
            }

            const rec = {
              slug: importedRepoSlug, // Use slugified repo name for URLs
              entity,
              entityDisplayName: entityInfo.displayName,
              repo: importedRepoSlug, // Use slugified version for URLs
              repositoryName: importedRepoSlug, // CRITICAL: Store exact repositoryName for git-nostr-bridge compatibility
              name: originalRepoName, // CRITICAL: Preserve original GitHub name (with dots) for display
              // Always set ownerPubkey for reliable ownership detection
              ownerPubkey: pubkey || undefined,
              sourceUrl:
                (isForkIntent
                  ? parentForgeSource || importedForgeSource
                  : d.sourceUrl || d.htmlUrl || normalizedUrl) || undefined,
              forkedFrom: isForkIntent
                ? gittrForkPointer(forkEntity, forkRepo)
                : githubParentForkedFrom({
                    htmlUrl: d.htmlUrl || d.sourceUrl || normalizedUrl,
                    isFork: d.isGithubFork,
                    parentHtmlUrl: d.parentHtmlUrl,
                  }),
              clone: isForkIntent
                ? forkSource?.clone && forkSource.clone.length > 0
                  ? forkSource.clone
                  : used.via !== "forge-source"
                  ? [normalizedUrl]
                  : undefined
                : undefined,
              readme:
                d.readme || (isForkIntent ? forkSource?.readme : undefined),
              fileCount: fileCount, // CRITICAL: Only store fileCount, not full files array (prevents quota exceeded)
              description:
                (isForkIntent ? forkSource?.description : undefined) ||
                d.description,
              stars: d.stars,
              forks: d.forks,
              languages: d.languages,
              topics: d.topics,
              // Always include contributors array (never undefined) - at minimum the owner
              contributors:
                contributors.length > 0
                  ? contributors
                  : pubkey
                  ? [{ pubkey, name: entityInfo.displayName, weight: 100 }]
                  : [],
              defaultBranch: d.defaultBranch,
              branches: d.branches || [],
              tags: d.tags || [],
              releases: d.releases || [],
              createdAt: Date.now(),
              status: "local" as const,
            };
            // CRITICAL: Log entity to verify it's correct
            console.log("🔄 Importing via new page with entity:", {
              entity: rec.entity,
              entityDisplayName: rec.entityDisplayName,
              ownerPubkey: rec.ownerPubkey?.slice(0, 8),
              expectedEntity: entityInfo.entitySlug,
              pubkey: pubkey?.slice(0, 8),
              repoName: rec.name,
              isValidEntity:
                rec.entity.startsWith("npub") &&
                !rec.entity.includes("gittr.space"),
            });

            // CRITICAL: Final validation before saving
            if (
              !rec.entity ||
              rec.entity === "gittr.space" ||
              (!rec.entity.startsWith("npub") && rec.entity.includes("."))
            ) {
              setStatus(
                `Error: Invalid entity "${rec.entity}". Repository not saved.`
              );
              console.error(
                "❌ [New Repo] Invalid entity detected, not saving:",
                rec.entity
              );
              return;
            }

            const nextRepos =
              duplicateIdx >= 0
                ? repos.map((r: StoredRepo, i: number) =>
                    i === duplicateIdx ? { ...r, ...rec } : r
                  )
                : [rec, ...repos];
            localStorage.setItem("gittr_repos", JSON.stringify(nextRepos));

            clearDeletedRepoTombstones({
              entity,
              repo: importedRepoSlug,
              ownerPubkey: pubkey || undefined,
            });

            // Dispatch event to update repositories page
            window.dispatchEvent(new CustomEvent("gittr:repo-created"));

            // Local only — publish via Push to Nostr on the repo page.
          } catch (storageErr: any) {
            console.error(
              "❌ [New Repo] Failed to save imported repo:",
              storageErr
            );
            setStatus(
              `Import partially failed while saving locally: ${
                storageErr?.message || storageErr
              }`
            );
            return;
          }
          // Only redirect if repo was successfully created
          if (importedRepoSlug && entityInfo) {
            const next =
              isForkIntent && importedFileCount === 0
                ? `/${entityInfo.entitySlug}/${importedRepoSlug}/upload`
                : isForkIntent
                ? `/${entityInfo.entitySlug}/${importedRepoSlug}`
                : "/repositories";
            setTimeout(() => router.push(next), 600);
            return;
          } else {
            setStatus(
              `Import failed: Repository was not created. ${
                d.message || d.status || "Unknown error"
              }`
            );
            if (!isForkIntent) return;
          }
        } else if (!isForkIntent) {
          setStatus(`Import failed: ${lastError || "Unknown error"}`);
          return;
        } else {
          setStatus(
            `Could not clone the parent (${
              lastError || "unknown error"
            }). Trying a local copy…`
          );
        }
      } catch (importErr: any) {
        console.error("❌ [New Repo] Import error:", importErr);
        if (!isForkIntent) {
          setStatus(
            `Import failed: ${importErr?.message || String(importErr)}`
          );
          return;
        }
        setStatus(
          `Could not clone the parent (${
            importErr?.message || importErr
          }). Trying a local copy…`
        );
      } finally {
        setImporting(false);
      }
    }

    {
      // Empty create, or fork fallback when clone failed.
      if (!isForkIntent && importCandidates.length > 0) return;
      if (!isForkIntent && !name.trim()) return;
      const repoSlug = slugify(name || "repo");
      if (!repoSlug) {
        setStatus("Error: Repository name is not valid for URL");
        return;
      }
      const entity = entityInfo.entitySlug; // This is npub format (GRASP protocol standard)

      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const duplicateIdx = repos.findIndex(
          (r: any) =>
            findRepoByEntityAndName<StoredRepo>([r], entity, repoSlug) !==
            undefined
        );
        // If forking, copy source repo files/readme/metadata
        const isFork = !!(forkEntity && forkRepo && forkSource);

        // CRITICAL: Validate source repo before forking (prevent forking corrupted repos)
        if (isFork && forkSource) {
          const validation = validateRepoForForkOrSign(forkSource);
          if (!validation.valid) {
            setStatus(
              `Error: Cannot fork corrupted repository. ${validation.error}`
            );
            return;
          }
        }

        // Ensure owner is ALWAYS in contributors array with pubkey for icon resolution
        let contributors: StoredContributor[] = [];

        if (isFork) {
          // When forking, include original contributors but ensure new owner is added
          contributors = [...(forkSource.contributors || [])];
          // Add new owner if not already present (or replace if present with lower weight)
          if (pubkey) {
            const existingOwnerIdx = contributors.findIndex(
              (c: any) => c.pubkey === pubkey
            );
            const ownerContributor = {
              pubkey,
              name: entityInfo.displayName,
              weight: 100,
            };
            if (existingOwnerIdx >= 0) {
              contributors[existingOwnerIdx] = ownerContributor; // Replace with owner weight
            } else {
              contributors.unshift(ownerContributor); // Add owner at the beginning
            }
          }
        } else {
          // New repo - owner must always be present
          if (pubkey) {
            contributors = [
              { pubkey, name: entityInfo.displayName, weight: 100 },
            ];
          }
        }

        // Ensure we always have at least the owner (if pubkey exists)
        if (!contributors.length && pubkey) {
          contributors = [
            { pubkey, name: entityInfo.displayName, weight: 100 },
          ];
        }

        // CRITICAL: Validate entity is not a domain name or empty
        if (
          !entity ||
          entity === "gittr.space" ||
          (entity.includes(".") && !entity.startsWith("npub"))
        ) {
          setStatus(
            `Error: Invalid entity "${entity}". Repository not created.`
          );
          return;
        }

        // CRITICAL: Store files separately to avoid localStorage quota issues
        // Only store fileCount in repo object, not full files array
        let fileCount = 0;
        if (isFork && forkSource) {
          const { loadRepoFiles, saveRepoFiles } = await import(
            "@/lib/repos/storage"
          );
          const fromObject = Array.isArray(forkSource.files)
            ? forkSource.files
            : [];
          const filesToCopy =
            fromObject.length > 0
              ? fromObject
              : loadRepoFiles(forkEntity, forkRepo);

          if (filesToCopy.length > 0) {
            fileCount = filesToCopy.length;
            try {
              saveRepoFiles(entity, repoSlug, filesToCopy);
              console.log(
                `✅ [New Repo] Saved ${fileCount} files to separate storage for fork ${entity}/${repoSlug}`
              );
            } catch (e: any) {
              console.error(
                `❌ [New Repo] Failed to save files separately for fork:`,
                e
              );
              fileCount = 0;
            }
          }
        }

        const rec = {
          slug: repoSlug,
          entity: entity, // CRITICAL: This is npub format (GRASP protocol standard), NOT GitHub username
          entityDisplayName: entityInfo.displayName,
          repo: repoSlug,
          repositoryName: repoSlug, // CRITICAL: Store exact repositoryName for git-nostr-bridge compatibility
          name: name || repoSlug,
          // Always set ownerPubkey for reliable ownership detection
          ownerPubkey: pubkey || undefined,
          // Carry over code and readme on fork
          readme: isFork ? forkSource.readme || "" : undefined,
          fileCount: fileCount, // CRITICAL: Only store fileCount, not full files array (prevents quota exceeded)
          // Keep attribution of source
          forkedFrom: isFork
            ? gittrForkPointer(forkEntity, forkRepo)
            : undefined,
          sourceUrl: isFork
            ? forkSource.sourceUrl &&
              isCloneableUpstreamSourceUrl(forkSource.sourceUrl)
              ? forkSource.sourceUrl
              : undefined
            : undefined,
          clone: isFork ? forkSource.clone : undefined,
          // Carry over description and topics where useful
          description: isFork ? forkSource.description || undefined : undefined,
          topics: isFork ? forkSource.topics || [] : undefined,
          languages: isFork ? forkSource.languages || undefined : undefined,
          // Always include contributors array (never undefined) - at minimum the owner
          // Ensure owner is always first with weight 100
          contributors: (() => {
            if (contributors.length === 0 && pubkey) {
              return [{ pubkey, name: entityInfo.displayName, weight: 100 }];
            }
            // Ensure owner is at the beginning with weight 100
            if (pubkey) {
              const ownerIndex = contributors.findIndex(
                (c) => c.pubkey === pubkey
              );
              if (ownerIndex >= 0) {
                // Move owner to first position and set weight to 100
                const owner = { ...contributors[ownerIndex], weight: 100 };
                const others = contributors.filter((_, i) => i !== ownerIndex);
                return [owner, ...others];
              } else {
                // Add owner at the beginning
                return [
                  { pubkey, name: entityInfo.displayName, weight: 100 },
                  ...contributors,
                ];
              }
            }
            return contributors;
          })(),
          defaultBranch: isFork ? forkSource.defaultBranch : undefined,
          branches: isFork ? forkSource.branches : undefined,
          createdAt: Date.now(),
          status: "local" as const,
        } as any;
        // CRITICAL: Ensure contributors array is saved with owner
        if (!rec.contributors || rec.contributors.length === 0) {
          if (pubkey) {
            rec.contributors = [
              { pubkey, name: entityInfo.displayName, weight: 100 },
            ];
          }
        }
        // CRITICAL: Log entity to verify it's correct
        console.log("🔄 Creating repo with entity:", {
          entity: rec.entity,
          entityDisplayName: rec.entityDisplayName,
          ownerPubkey: rec.ownerPubkey?.slice(0, 8),
          expectedEntity: entityInfo.entitySlug,
          pubkey: pubkey?.slice(0, 8),
          isValidEntity:
            rec.entity.startsWith("npub") &&
            !rec.entity.includes("gittr.space"),
          repoName: rec.name,
        });

        // CRITICAL: Final validation before saving
        if (
          !rec.entity ||
          rec.entity === "gittr.space" ||
          (!rec.entity.startsWith("npub") && rec.entity.includes("."))
        ) {
          setStatus(
            `Error: Invalid entity "${rec.entity}". Repository not saved.`
          );
          console.error(
            "❌ [New Repo] Invalid entity detected, not saving:",
            rec.entity
          );
          return;
        }

        const nextRepos =
          duplicateIdx >= 0
            ? repos.map((r: StoredRepo, i: number) =>
                i === duplicateIdx
                  ? isFork
                    ? { ...r, ...rec }
                    : // Recreate under same name: do not keep stale forkedFrom /
                      // sourceUrl / event ids from a previously deleted row.
                      { ...rec }
                  : r
              )
            : [rec, ...repos];
        localStorage.setItem("gittr_repos", JSON.stringify(nextRepos));

        // Same as import: reopen must clear the local delete tombstone or My
        // Repositories / Explore / Profile keep hiding the live repo.
        clearDeletedRepoTombstones({
          entity,
          repo: repoSlug,
          ownerPubkey: pubkey || undefined,
        });

        // Dispatch event to update repositories page
        window.dispatchEvent(new CustomEvent("gittr:repo-created"));

        // Local only — publish via Push to Nostr on the repo page.

        // Only redirect if repo was successfully created
        if (repoSlug && entity) {
          // Empty repos go straight to upload (files + folders / drag-drop).
          // Forks that already copied files open the repo page.
          const next =
            !isFork || fileCount === 0
              ? `/${entity}/${repoSlug}/upload`
              : `/${entity}/${repoSlug}`;
          setTimeout(() => router.push(next), 400);
        } else {
          setStatus(
            "Error: Repository was not created. Please check the name and try again."
          );
        }
      } catch (error: any) {
        console.error("Failed to create repo:", error);
        setStatus(
          `Error: Failed to create repository. ${
            error.message || "Unknown error"
          }`
        );
      }
    }
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">
        {forkEntity && forkRepo ? "Fork repository" : "Create repository"}
      </h1>

      {forkEntity && forkRepo && (
        <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/50 rounded">
          <h2 className="mb-2 font-semibold text-purple-400">
            Fork {forkEntity}/{forkRepo}
          </h2>
          <p className="mb-3 text-sm text-gray-300">
            Copies the files from the parent — GitHub/GitLab if it has an
            external source, otherwise the Nostr/GRASP git clone. Local until
            you Push to Nostr.
          </p>
          <label className="mb-2 block text-sm font-medium">
            Repository Name
          </label>
          <input
            className="w-full border p-2 text-black"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={forkRepo}
          />
          <button
            className="mt-3 rounded border border-purple-500 bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={submit}
            disabled={!name.trim() || importing || !forkHintsReady}
          >
            {importing
              ? "Forking…"
              : !forkHintsReady
              ? "Looking up parent…"
              : "Fork repository"}
          </button>
          {status && (
            <div className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">
              {status}
            </div>
          )}
        </div>
      )}

      <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/50 rounded">
        <h2 className="font-semibold text-purple-400 mb-2">
          📥 Option 1: Import single repository
        </h2>
        <p className="text-sm text-gray-300 mb-3">
          One repo at a time. <strong className="text-gray-200">GitHub:</strong>{" "}
          short <code className="bg-gray-800 px-1 rounded">owner/repo</code> or
          full URL.{" "}
          <strong className="text-gray-200">GitLab, Codeberg, Gitea,</strong>{" "}
          Forgejo, or other hosts: full clone URL.{" "}
          <strong className="text-gray-200">Nostr-only:</strong> paste{" "}
          <code className="bg-gray-800 px-1 rounded">npub…/repo</code>, a{" "}
          <code className="bg-gray-800 px-1 rounded">
            gittr.space/npub…/repo
          </code>{" "}
          page, or a GRASP clone URL (
          <code className="bg-gray-800 px-1 rounded">
            https://git.gittr.space/…
          </code>
          ).
        </p>
        <label className="block text-sm font-medium mb-2">
          Repository link
        </label>
        <input
          className="w-full border p-2 text-black"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => {
            // Auto-add https:// for web URLs, but not for git@ or git:// URLs
            // Also don't auto-add for GitHub name format (owner/repo)
            const value = e.target.value.trim();
            const githubNamePattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
            if (
              value &&
              !value.startsWith("http://") &&
              !value.startsWith("https://") &&
              !value.startsWith("git@") &&
              !value.startsWith("git://") &&
              !githubNamePattern.test(value) &&
              value.includes(".") &&
              !value.includes("@")
            ) {
              setUrl(`https://${value}`);
            }
          }}
          placeholder="arbadacarbaYK/gittr · https://codeberg.org/owner/repo · https://gitlab.com/group/repo"
        />
        <p className="text-xs mt-1 text-gray-400">
          Examples: <code className="bg-gray-800 px-1 rounded">owner/repo</code>{" "}
          (GitHub only),{" "}
          <code className="bg-gray-800 px-1 rounded">
            https://codeberg.org/owner/repo
          </code>
          ,{" "}
          <code className="bg-gray-800 px-1 rounded">
            git@host:owner/repo.git
          </code>
          . For many GitHub repos, use Option 3 below.
        </p>
        <button
          className="mt-3 border border-purple-500 bg-purple-600 hover:bg-purple-700 px-4 py-2 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={submit}
          disabled={!url.trim() || importing}
        >
          {importing
            ? "Importing…"
            : url.trim()
            ? "Import & Create"
            : "Enter URL to import"}
        </button>
        {status && (
          <div className="mt-3 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">
            {status}
          </div>
        )}
      </div>

      <div className="mb-6 p-4 bg-gray-800/50 border border-gray-700 rounded">
        <h2 className="font-semibold mb-2">
          ➕ Option 2: Create empty repository
        </h2>
        <p className="text-sm text-gray-300 mb-2">
          Create a new empty repository from scratch. After create you&apos;ll
          land on Upload — drag &amp; drop files or whole folders (paths
          preserved).
        </p>
        <label className="block text-sm font-medium mb-2">
          Repository Name
        </label>
        <input
          className="w-full border p-2 text-black"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="repo-name"
        />
        <button
          className="mt-3 border px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          onClick={submit}
          disabled={!name.trim()}
        >
          {name.trim() ? "Create Empty Repository" : "Enter name to create"}
        </button>
      </div>

      <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/50 rounded">
        <h2 className="font-semibold text-purple-400 mb-2">
          📦 Option 3: Bulk import from GitHub
        </h2>
        <p className="text-sm text-gray-300 mb-3">
          Opens the bulk import page: you <strong>fetch a list</strong>, then{" "}
          <strong>tick which repos</strong> to import. Nothing is imported until
          you run import there — your Git is not auto-synced from this button.
          You can import many selected repos in one go, or only a few.
        </p>
        <p className="text-sm text-amber-200/90 mb-3">
          <strong>GitHub only.</strong> GitLab, Codeberg, Gitea, Forgejo →
          Option 1 with a full URL (one repo each).
        </p>
        <button
          className="border px-4 py-2 inline-block bg-purple-600 hover:bg-purple-700 text-white rounded"
          onClick={() => {
            // Extract GitHub username from URL field (if user entered one in Option 1)
            let githubUser = "";
            const trimmed = url.trim();

            if (trimmed) {
              // Try to extract from URL pattern
              const urlMatch = trimmed.match(/github\.com\/([^\/]+)/);
              if (urlMatch && urlMatch[1]) {
                githubUser = urlMatch[1];
              } else if (trimmed.match(/^[a-zA-Z0-9_-]+$/)) {
                // If it's just a username (no slashes, no dots, no protocol)
                githubUser = trimmed;
              } else {
                // Try to extract from any URL
                try {
                  const urlObj = new URL(
                    trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
                  );
                  const pathParts = urlObj.pathname.split("/").filter(Boolean);
                  if (pathParts.length > 0 && pathParts[0]) {
                    githubUser = pathParts[0];
                  }
                } catch {
                  // If URL parsing fails, treat as username if it looks like one
                  if (trimmed.match(/^[a-zA-Z0-9_-]+$/)) {
                    githubUser = trimmed;
                  }
                }
              }
            }

            // Navigate to import page with username
            if (githubUser) {
              window.location.href = `/import?user=${encodeURIComponent(
                githubUser
              )}`;
            } else {
              window.location.href = "/import";
            }
          }}
        >
          Open bulk import (choose repos next)
        </button>
        <p className="text-xs mt-2 text-gray-400">
          <strong>Tip:</strong> Safe to open — no import runs until you select
          repos and confirm on the next page. If you entered a GitHub username
          or URL in Option 1 above, it will be pre-filled there.
        </p>
      </div>
      {/* Debug: Show entity info - only render on client to avoid hydration mismatch */}
      {mounted && isLoggedIn && pubkey && (
        <div className="mt-4 p-3 bg-gray-800 rounded text-sm">
          <div className="text-gray-400">Your Nostr Identity (npub):</div>
          <div className="text-purple-400 font-mono break-all">
            {(() => {
              try {
                return nip19.npubEncode(pubkey);
              } catch {
                return pubkey.slice(0, 16) + "...";
              }
            })()}
          </div>
          <div className="text-gray-400 mt-2">Display Name:</div>
          <div className="text-purple-400">{userName || "Anonymous"}</div>
        </div>
      )}
      {readme && (
        <div className="mt-4 border p-2">
          <h2 className="font-semibold mb-2">README.md</h2>
          <pre className="whitespace-pre-wrap">{readme}</pre>
        </div>
      )}
    </div>
  );
}

// Mark as dynamic to prevent static generation (useSearchParams requires dynamic rendering)
export const dynamic = "force-dynamic";

export default function NewRepoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white p-8">Loading...</div>
      }
    >
      <NewRepoPageContent />
    </Suspense>
  );
}
