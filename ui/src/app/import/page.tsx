"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { recordActivity } from "@/lib/activity-tracking";
import { mapGithubContributors } from "@/lib/github-mapping";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { createRepositoryEvent } from "@/lib/nostr/events";
import {
  publishWithConfirmation,
  storeRepoEventId,
} from "@/lib/nostr/publish-with-confirmation";
import useSession from "@/lib/nostr/useSession";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";

function slugify(text: string): string {
  // Normalize repo names for imported repos to URL-safe format
  // Use hyphens (kebab-case) instead of underscores for better URL readability
  // This ensures imported repos have clean URLs, matching the pattern for new repos
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-") // Replace spaces with hyphens (kebab-case)
    .replace(/[_-]+/g, "-") // Collapse multiple underscores/hyphens into single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
  return slug || "";
}

function normalizeGithubUrl(input: string): string {
  // Remove whitespace
  let url = input.trim();

  // If it's just a username (no slashes, no github.com), make it a profile URL directly
  if (
    !url.includes("/") &&
    !url.includes("github.com") &&
    !url.includes("http://") &&
    !url.includes("https://")
  ) {
    return `https://github.com/${url}`;
  }

  // If it doesn't start with http/https, add https://
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  // Now try to parse as URL
  try {
    const urlObj = new URL(url);

    // If hostname is github.com, use it as-is
    if (
      urlObj.hostname === "github.com" ||
      urlObj.hostname.includes("github.com")
    ) {
      // If pathname is empty or just /, and we have a username, use it
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      if (pathParts.length === 0 && input.trim().match(/^[a-zA-Z0-9_-]+$/)) {
        return `https://github.com/${input.trim()}`;
      }
      return url;
    }

    // If hostname is not github.com, but looks like a username
    if (urlObj.hostname.match(/^[a-zA-Z0-9_-]+$/)) {
      return `https://github.com/${urlObj.hostname}`;
    }

    // Default: try to use pathname
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      return `https://github.com/${pathParts[0]}`;
    }
  } catch (e) {
    // If URL parsing fails, treat input as username
    if (input.trim().match(/^[a-zA-Z0-9_-]+$/)) {
      return `https://github.com/${input.trim()}`;
    }
  }

  return url;
}

interface GithubRepo {
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  languages_url: string;
  topics: string[];
  default_branch: string;
  private: boolean;
}

export default function ImportPage() {
  const [githubUrl, setGithubUrl] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [showImportAllConfirm, setShowImportAllConfirm] = useState(false);
  const router = useRouter();
  const { publish, subscribe, defaultRelays, pubkey } = useNostrContext();
  const { name: userName, isLoggedIn } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedUrlRef = useRef<string>("");

  useEffect(() => {
    // Load previously imported repos to mark them
    try {
      const existingRepos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      );
      // Could mark repos that are already imported, but for now we'll just show all
    } catch {}

    // Check for GitHub username in URL params (from /new page)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const githubUser = params.get("user") || params.get("github");
      if (githubUser && !githubUrl) {
        setGithubUrl(githubUser);
      }
    }
  }, []);

  // Auto-import all when importAll flag is set and repos are loaded
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const importAll = params.get("importAll") === "true";
      // Only auto-import if:
      // 1. importAll flag is set
      // 2. Repos are loaded
      // 3. Not currently importing
      // 4. User is logged in
      // 5. No repos selected yet (to avoid double-import)
      if (
        importAll &&
        repos.length > 0 &&
        !importing &&
        isLoggedIn &&
        selectedRepos.size === 0
      ) {
        console.log("Auto-importing all repos due to importAll flag");
        // Select all and import
        const allRepos = new Set(repos.map((r) => r.full_name));
        setSelectedRepos(allRepos);
        // Trigger import after a short delay to ensure state is updated
        setTimeout(() => {
          // Create a temporary function to import all repos directly
          const importAllRepos = async () => {
            if (allRepos.size === 0) return;

            if (!isLoggedIn || !userName || userName === "Anonymous Nostrich") {
              setStatus("You must be logged in to import repositories");
              return;
            }

            setImporting(true);
            setStatus(`Importing ${allRepos.size} repositories...`);

            try {
              if (!pubkey || typeof pubkey !== "string") {
                setStatus(
                  "Error: Must be logged in with Nostr key to import repositories"
                );
                setImporting(false);
                return;
              }
              const pubkeyStr = String(pubkey);
              if (!pubkeyStr || !/^[0-9a-f]{64}$/i.test(pubkeyStr)) {
                setStatus(
                  "Error: Must be logged in with Nostr key to import repositories"
                );
                setImporting(false);
                return;
              }

              // Use npub format for entity (GRASP protocol standard, matches URLs)
              let entityNpub: string;
              try {
                entityNpub = nip19.npubEncode(pubkeyStr);
              } catch (e) {
                console.error("Failed to encode npub:", e);
                setStatus("Error: Invalid pubkey format");
                setImporting(false);
                return;
              }

              const entityInfo = {
                entitySlug: entityNpub, // Use npub format (GRASP protocol standard)
                displayName: userName,
              };

              const existingRepos = JSON.parse(
                localStorage.getItem("gittr_repos") || "[]"
              );
              let importedCount = 0;
              let skippedCount = 0;

              for (const fullName of allRepos) {
                const repo = repos.find((r) => r.full_name === fullName);
                if (!repo) continue;

                const repoSlug = slugify(repo.name);
                const existingMatch = existingRepos.find((r: any) => {
                  // Match by entity AND repo slug (same user, same repo name)
                  const found = findRepoByEntityAndName(
                    [r],
                    entityInfo.entitySlug,
                    repoSlug
                  );
                  if (found !== undefined) return true;

                  // Match by ownerPubkey AND repo slug (catches duplicates even if entity format changed)
                  if (
                    pubkey &&
                    r.ownerPubkey &&
                    r.ownerPubkey.toLowerCase() === pubkey.toLowerCase()
                  ) {
                    const rRepo = (r.repo || r.slug || "").trim().toLowerCase();
                    const newRepo = repoSlug.trim().toLowerCase();
                    if (rRepo === newRepo || rRepo.endsWith(`/${newRepo}`)) {
                      return true;
                    }
                  }

                  // Also check by sourceUrl BUT only if same entity (prevent duplicate imports by same user)
                  // Different users can import the same GitHub repo, so don't block that
                  if (
                    r.entity === entityInfo.entitySlug &&
                    (r.sourceUrl === repo.html_url ||
                      r.forkedFrom === repo.html_url)
                  ) {
                    return true;
                  }
                  return false;
                });

                if (existingMatch) {
                  skippedCount++;
                  continue;
                }

                try {
                  const importResponse = await fetch("/api/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sourceUrl: repo.html_url }),
                  });

                  if (!importResponse.ok) {
                    skippedCount++;
                    continue;
                  }

                  const importData = await importResponse.json();
                  if (importData.status !== "completed") {
                    skippedCount++;
                    continue;
                  }

                  let contributors: Array<{
                    pubkey?: string;
                    name?: string;
                    picture?: string;
                    weight: number;
                    githubLogin?: string;
                  }> = [];

                  if (
                    importData.contributors &&
                    Array.isArray(importData.contributors) &&
                    importData.contributors.length > 0
                  ) {
                    contributors = mapGithubContributors(
                      importData.contributors,
                      pubkey || undefined,
                      undefined,
                      false
                    );
                  }

                  if (pubkey) {
                    const ownerInList = contributors.some(
                      (c) => c.pubkey === pubkey
                    );
                    if (!ownerInList) {
                      contributors.unshift({
                        pubkey: pubkey,
                        name: entityInfo.displayName,
                        weight: 100,
                      });
                    } else {
                      const ownerIndex = contributors.findIndex(
                        (c) => c.pubkey === pubkey
                      );
                      if (ownerIndex >= 0) {
                        const owner = contributors[ownerIndex];
                        if (owner) {
                          owner.weight = 100;
                          contributors.splice(ownerIndex, 1);
                          contributors.unshift(owner);
                        }
                      }
                    }
                  } else if (contributors.length === 0) {
                    contributors = [
                      { name: entityInfo.displayName, weight: 100 },
                    ];
                  }

                  // Store files separately to avoid localStorage quota issues
                  let fileCount = 0;
                  if (
                    importData.files &&
                    Array.isArray(importData.files) &&
                    importData.files.length > 0
                  ) {
                    fileCount = importData.files.length;
                    try {
                      const filesKey = getRepoStorageKey(
                        "gittr_files",
                        entityInfo.entitySlug,
                        repoSlug
                      );
                      localStorage.setItem(
                        filesKey,
                        JSON.stringify(importData.files)
                      );
                    } catch (e) {
                      console.error(
                        `❌ [Import] Failed to save files separately for ${fullName}:`,
                        e
                      );
                      fileCount = importData.files.length;
                    }
                  }

                  const rec = {
                    slug: repoSlug,
                    entity: entityInfo.entitySlug, // Use npub format (GRASP protocol standard)
                    entityDisplayName: entityInfo.displayName,
                    repo: repoSlug,
                    name: repo.name,
                    sourceUrl: repo.html_url,
                    forkedFrom: repo.html_url,
                    readme: importData.readme,
                    fileCount: fileCount, // Store only count, not full array
                    description: importData.description || repo.description,
                    stars: importData.stars || repo.stargazers_count,
                    forks: importData.forks || repo.forks_count,
                    languages: importData.languages || {},
                    topics: importData.topics || repo.topics || [],
                    contributors,
                    defaultBranch:
                      importData.defaultBranch || repo.default_branch,
                    branches: importData.branches || [],
                    tags: importData.tags || [],
                    releases: importData.releases || [],
                    // Preserve GitHub privacy status (defaults to public if not set)
                    publicRead: importData.isPrivate === true ? false : true,
                    // Don't store issues/pulls/commits in main repo object - they're stored separately
                    createdAt: Date.now(),
                    ownerPubkey: pubkey || undefined,
                  };

                  if (
                    !rec.contributors ||
                    rec.contributors.length === 0 ||
                    !rec.contributors.some((c: any) => c.pubkey === pubkey)
                  ) {
                    if (pubkey) {
                      if (!rec.contributors) rec.contributors = [];
                      rec.contributors = rec.contributors.filter(
                        (c: any) => !c.pubkey || c.pubkey !== pubkey
                      );
                      rec.contributors.unshift({
                        pubkey,
                        name: entityInfo.displayName,
                        weight: 100,
                      });
                    }
                  }

                  existingRepos.push(rec);
                  importedCount++;

                  // Save issues, pulls, and commits to separate localStorage keys for the issues/pulls/commits pages
                  if (
                    importData.issues &&
                    Array.isArray(importData.issues) &&
                    importData.issues.length > 0
                  ) {
                    try {
                      const issuesKey = getRepoStorageKey(
                        "gittr_issues",
                        entityInfo.entitySlug,
                        repoSlug
                      );
                      const formattedIssues = importData.issues.map(
                        (issue: any) => ({
                          id: `issue-${issue.number}`,
                          entity: entityInfo.entitySlug,
                          repo: repoSlug,
                          title: issue.title || "",
                          number: String(issue.number || ""),
                          status: issue.state === "closed" ? "closed" : "open",
                          author: issue.user?.login || "",
                          labels:
                            issue.labels?.map((l: any) => l.name || l) || [],
                          assignees: [],
                          createdAt: issue.created_at
                            ? new Date(issue.created_at).getTime()
                            : Date.now(),
                          body: issue.body || "",
                          html_url: issue.html_url || "",
                        })
                      );
                      localStorage.setItem(
                        issuesKey,
                        JSON.stringify(formattedIssues)
                      );
                    } catch (e) {
                      console.error(
                        `❌ [Import] Failed to save issues for ${fullName}:`,
                        e
                      );
                    }
                  }

                  if (
                    importData.pulls &&
                    Array.isArray(importData.pulls) &&
                    importData.pulls.length > 0
                  ) {
                    try {
                      const pullsKey = getRepoStorageKey(
                        "gittr_prs",
                        entityInfo.entitySlug,
                        repoSlug
                      );
                      const formattedPRs = importData.pulls.map((pr: any) => ({
                        id: `pr-${pr.number}`,
                        entity: entityInfo.entitySlug,
                        repo: repoSlug,
                        title: pr.title || "",
                        number: String(pr.number || ""),
                        status: pr.merged_at
                          ? "merged"
                          : pr.state === "closed"
                          ? "closed"
                          : "open",
                        author: pr.user?.login || "",
                        labels: pr.labels?.map((l: any) => l.name || l) || [],
                        assignees: [],
                        createdAt: pr.created_at
                          ? new Date(pr.created_at).getTime()
                          : Date.now(),
                        body: pr.body || "",
                        html_url: pr.html_url || "",
                        merged_at: pr.merged_at || null,
                        head: pr.head?.ref || null,
                        base: pr.base?.ref || null,
                      }));
                      localStorage.setItem(
                        pullsKey,
                        JSON.stringify(formattedPRs)
                      );
                    } catch (e) {
                      console.error(
                        `❌ [Import] Failed to save pull requests for ${fullName}:`,
                        e
                      );
                    }
                  }

                  if (
                    importData.commits &&
                    Array.isArray(importData.commits) &&
                    importData.commits.length > 0
                  ) {
                    try {
                      const commitsKey = getRepoStorageKey(
                        "gittr_commits",
                        entityInfo.entitySlug,
                        repoSlug
                      );
                      const formattedCommits = importData.commits.map(
                        (commit: any) => ({
                          id: commit.sha || `commit-${Date.now()}`,
                          message: commit.message || "",
                          author:
                            commit.author?.email ||
                            commit.committer?.email ||
                            "",
                          authorName:
                            commit.author?.name || commit.committer?.name || "",
                          timestamp:
                            commit.author?.date || commit.committer?.date
                              ? new Date(
                                  commit.author?.date || commit.committer?.date
                                ).getTime()
                              : Date.now(),
                          branch: importData.defaultBranch || "main",
                          html_url: commit.html_url || "",
                        })
                      );
                      localStorage.setItem(
                        commitsKey,
                        JSON.stringify(formattedCommits)
                      );
                    } catch (e) {
                      console.error(
                        `❌ [Import] Failed to save commits for ${fullName}:`,
                        e
                      );
                    }
                  }

                  if (pubkey) {
                    try {
                      recordActivity({
                        type: "repo_imported",
                        user: pubkey,
                        repo: `${entityInfo.entitySlug}/${repoSlug}`,
                        entity: entityInfo.entitySlug, // Use npub format (GRASP protocol standard)
                        repoName: rec.name,
                        metadata: {
                          sourceUrl: repo.html_url,
                          forkedFrom: repo.html_url,
                        },
                      });
                    } catch (error) {
                      console.error("Failed to record import activity:", error);
                    }
                  }

                  if (publish && pubkey) {
                    try {
                      const privateKey = await getNostrPrivateKey();
                      if (privateKey) {
                        // Get git server URL from env or use default
                        const gitServerUrl =
                          process.env.NEXT_PUBLIC_GIT_SERVER_URL ||
                          (typeof window !== "undefined"
                            ? `${window.location.protocol}//${window.location.host}`
                            : "https://gittr.space");

                        const repoEvent = createRepositoryEvent(
                          {
                            repositoryName: repoSlug,
                            publicRead: rec.publicRead !== false, // Preserve privacy status from import
                            publicWrite: false,
                            description:
                              rec.description ||
                              `Imported from ${repo.html_url}`,
                            sourceUrl: repo.html_url,
                            forkedFrom: repo.html_url,
                            readme: rec.readme,
                            // Files are stored separately - not included in event
                            stars: rec.stars,
                            forks: rec.forks,
                            languages: rec.languages,
                            topics: rec.topics,
                            contributors: rec.contributors,
                            defaultBranch: rec.defaultBranch,
                            branches: rec.branches,
                            releases: rec.releases,
                            // GRASP-01: Add clone and relays tags
                            clone: [gitServerUrl], // Git server URL where repo is hosted
                            relays: defaultRelays, // Nostr relays where repo events are published
                          },
                          privateKey
                        );

                        // Publish with confirmation and store event ID
                        try {
                          if (!publish || !subscribe) {
                            console.error(
                              `❌ [Import] Cannot publish ${fullName}: publish or subscribe is undefined`
                            );
                            continue;
                          }
                          const result = await publishWithConfirmation(
                            publish,
                            subscribe,
                            repoEvent,
                            defaultRelays,
                            10000 // 10 second timeout
                          );

                          if (result.confirmed) {
                            storeRepoEventId(
                              repoSlug,
                              rec.entity,
                              result.eventId,
                              true
                            );
                          } else {
                            storeRepoEventId(
                              repoSlug,
                              rec.entity,
                              result.eventId,
                              false
                            );
                          }
                        } catch (pubError: any) {
                          console.error(
                            `Failed to publish ${fullName} with confirmation:`,
                            pubError
                          );
                        }
                      }
                    } catch (error: any) {
                      console.error(
                        `Failed to publish ${fullName} to Nostr:`,
                        error
                      );
                    }
                  }
                } catch (error: any) {
                  console.error(`Error importing ${fullName}:`, error);
                  skippedCount++;
                }
              }

              localStorage.setItem(
                "gittr_repos",
                JSON.stringify(existingRepos)
              );
              window.dispatchEvent(new CustomEvent("gittr:repo-imported"));

              setStatus(
                `Imported ${importedCount} repositories${
                  skippedCount > 0
                    ? `, ${skippedCount} skipped (already exist)`
                    : ""
                }`
              );
              setTimeout(() => {
                router.push("/repositories");
              }, 1500);
            } catch (error: any) {
              setStatus(`Import error: ${error.message}`);
            } finally {
              setImporting(false);
            }
          };

          importAllRepos();
        }, 100);
      }
    }
  }, [
    repos.length,
    importing,
    isLoggedIn,
    selectedRepos.size,
    pubkey,
    userName,
    publish,
    defaultRelays,
    router,
  ]);

  const fetchUserRepos = useCallback(async () => {
    if (!githubUrl.trim()) {
      setStatus("Please enter a GitHub username or profile URL");
      return;
    }

    setLoading(true);
    setStatus("Fetching repositories...");

    try {
      let username = "";
      const trimmed = githubUrl.trim();

      // Check if it's a plain username first (no dots, no slashes, no protocol)
      if (
        trimmed.match(/^[a-zA-Z0-9_-]+$/) &&
        !trimmed.includes(".") &&
        !trimmed.includes("/") &&
        !trimmed.includes("http")
      ) {
        username = trimmed;
        console.log("Import: Detected plain username:", username);
      } else {
        // Try to normalize and parse URL
        try {
          const normalizedUrl = normalizeGithubUrl(githubUrl);
          console.log("Import: Normalized URL:", normalizedUrl);
          const urlObj = new URL(normalizedUrl);
          const pathParts = urlObj.pathname.split("/").filter(Boolean);

          // Check if this is a specific repo URL (username/repo)
          if (pathParts.length >= 2 && urlObj.hostname.includes("github.com")) {
            // This is a specific repo URL - import it directly
            const repoUsername = pathParts[0];
            const repoNameFromUrl = pathParts[1];
            if (!repoNameFromUrl) {
              setStatus(`Invalid GitHub URL: missing repository name`);
              setLoading(false);
              return;
            }
            console.log("Import: Detected specific repo URL:", {
              repoUsername,
              repoNameFromUrl,
            });

            // First, try to fetch the repo with exact case
            let repoApiUrl = `https://api.github.com/repos/${repoUsername}/${repoNameFromUrl}`;
            let repoResponse = await fetch(repoApiUrl, {
              headers: { "User-Agent": "gittr-space" } as any,
            });

            // If exact case fails with 404, try fetching all user repos and find case-insensitive match
            if (!repoResponse.ok && repoResponse.status === 404) {
              console.log(
                "Import: Exact case not found, fetching all repos for case-insensitive match"
              );
              const userReposUrl = `https://api.github.com/users/${repoUsername}/repos?per_page=100`;
              const userReposResponse = await fetch(userReposUrl, {
                headers: { "User-Agent": "gittr-space" } as any,
              });

              if (userReposResponse.ok) {
                const allRepos: GithubRepo[] = await userReposResponse.json();
                // Find case-insensitive match
                const matchedRepo = allRepos.find(
                  (r) =>
                    r.name.toLowerCase() === repoNameFromUrl.toLowerCase() &&
                    !r.private
                );

                if (matchedRepo) {
                  console.log(
                    `Import: Found case-insensitive match: "${matchedRepo.name}" (requested: "${repoNameFromUrl}")`
                  );
                  // Set the single repo and auto-select it
                  setRepos([matchedRepo]);
                  setSelectedRepos(new Set([matchedRepo.full_name]));
                  setStatus(`Found repository: ${matchedRepo.name}`);
                  setLoading(false);

                  // Auto-import if user is logged in
                  if (isLoggedIn && pubkey) {
                    setTimeout(() => {
                      importSelected();
                    }, 500);
                  }
                  return;
                } else {
                  setStatus(
                    `Repository "${repoUsername}/${repoNameFromUrl}" not found (case-insensitive search also failed)`
                  );
                  setLoading(false);
                  return;
                }
              }
            }

            if (!repoResponse.ok) {
              if (repoResponse.status === 404) {
                setStatus(
                  `Repository "${repoUsername}/${repoNameFromUrl}" not found on GitHub`
                );
              } else {
                setStatus(
                  `Failed to fetch repository: ${repoResponse.statusText}`
                );
              }
              setLoading(false);
              return;
            }

            const repoData: GithubRepo = await repoResponse.json();

            // Only import if it's public
            if (repoData.private) {
              setStatus(
                `Repository "${repoData.name}" is private and cannot be imported`
              );
              setLoading(false);
              return;
            }

            // Set the single repo and auto-select it
            setRepos([repoData]);
            setSelectedRepos(new Set([repoData.full_name]));
            setStatus(`Found repository: ${repoData.name}`);
            setLoading(false);

            // Auto-import if user is logged in
            if (isLoggedIn && pubkey) {
              setTimeout(() => {
                importSelected();
              }, 500);
            }
            return;
          }

          // Otherwise, extract username for bulk import
          username = pathParts[0] || "";
          console.log("Import: Extracted username from URL:", username);
        } catch (urlError) {
          console.error("Import: URL parsing failed:", urlError);
          // If URL parsing fails, try treating input as username
          if (trimmed.match(/^[a-zA-Z0-9_-]+$/)) {
            username = trimmed;
            console.log("Import: Falling back to input as username:", username);
          }
        }
      }

      if (!username || username.length === 0) {
        setStatus(
          `Could not extract username from "${githubUrl}". Please enter a valid GitHub username (e.g., arbadacarbaYK) or profile URL.`
        );
        setLoading(false);
        return;
      }

      console.log("Import: Using username for API call:", username);

      // Fetch user's public repositories
      const apiUrl = `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`;
      const response = await fetch(apiUrl, {
        headers: { "User-Agent": "gittr" } as any,
      });

      if (!response.ok) {
        if (response.status === 404) {
          setStatus(`User "${username}" not found on GitHub`);
        } else {
          setStatus(`Failed to fetch repositories: ${response.statusText}`);
        }
        setLoading(false);
        return;
      }

      const data: GithubRepo[] = await response.json();
      // Filter out private repos (we can only import public ones)
      const publicRepos = data.filter((repo) => !repo.private);
      setRepos(publicRepos);
      setStatus(`Found ${publicRepos.length} public repositories`);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [githubUrl, isLoggedIn, pubkey]);

  // Debounced auto-fetch when githubUrl changes
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Don't auto-fetch if:
    // - Empty input
    // - Currently loading
    // - Same as last fetched (avoid duplicate fetches)
    if (
      !githubUrl.trim() ||
      loading ||
      githubUrl.trim() === lastFetchedUrlRef.current
    ) {
      return;
    }

    // Extract username from input (handle both username and URLs)
    const trimmed = githubUrl.trim();
    let username = "";

    // Check if it's a valid username format (simple check)
    if (trimmed.match(/^[a-zA-Z0-9_-]+$/)) {
      username = trimmed;
    } else if (trimmed.includes("github.com")) {
      // Try to extract username from URL
      try {
        const url = new URL(
          trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
        );
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length > 0 && pathParts[0]) {
          username = pathParts[0];
        }
      } catch (e) {
        // Invalid URL, wait for user to finish typing
        return;
      }
    } else {
      // Not a valid format yet, wait for user to finish typing
      return;
    }

    // Debounce: wait 500ms after user stops typing
    debounceTimerRef.current = setTimeout(() => {
      // Only fetch if username is valid and different from last fetch
      if (username && username !== lastFetchedUrlRef.current && !loading) {
        console.log("Auto-fetching repos for username:", username);
        lastFetchedUrlRef.current = username;
        fetchUserRepos();
      }
    }, 500);

    // Cleanup timer on unmount or when githubUrl changes
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [githubUrl, loading, fetchUserRepos]);

  function toggleRepo(fullName: string) {
    const newSelected = new Set(selectedRepos);
    if (newSelected.has(fullName)) {
      newSelected.delete(fullName);
    } else {
      newSelected.add(fullName);
    }
    setSelectedRepos(newSelected);
  }

  function toggleAll() {
    if (selectedRepos.size === repos.length) {
      setSelectedRepos(new Set());
    } else {
      setSelectedRepos(new Set(repos.map((r) => r.full_name)));
    }
  }

  async function importSelected() {
    if (selectedRepos.size === 0) {
      setStatus("Please select at least one repository to import");
      return;
    }

    if (!isLoggedIn || !userName || userName === "Anonymous Nostrich") {
      setStatus("You must be logged in to import repositories");
      return;
    }

    setImporting(true);
    setStatus(`Importing ${selectedRepos.size} repositories...`);

    try {
      // Use pubkey for entity (not username slug) - ensures URLs use Nostr ID
      if (!pubkey || typeof pubkey !== "string") {
        setStatus(
          "Error: Must be logged in with Nostr key to import repositories"
        );
        setImporting(false);
        return;
      }
      const pubkeyStr = String(pubkey); // Ensure it's a string
      if (!pubkeyStr || !/^[0-9a-f]{64}$/i.test(pubkeyStr)) {
        setStatus(
          "Error: Must be logged in with Nostr key to import repositories"
        );
        setImporting(false);
        return;
      }

      // Use npub format for entity (GRASP protocol standard, matches URLs)
      // This ensures consistency - no conversion needed between storage and URLs
      let entityNpub: string;
      try {
        entityNpub = nip19.npubEncode(pubkeyStr);
      } catch (e) {
        console.error("Failed to encode npub:", e);
        setStatus("Error: Invalid pubkey format");
        setImporting(false);
        return;
      }

      const entityInfo = {
        entitySlug: entityNpub, // Use npub format (GRASP protocol standard)
        displayName: userName,
      };

      const existingRepos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      );
      let importedCount = 0;
      let skippedCount = 0;

      for (const fullName of selectedRepos) {
        const repo = repos.find((r) => r.full_name === fullName);
        if (!repo) continue;

        const repoSlug = slugify(repo.name);
        // Check if repo already exists - match by entity AND repo slug
        // Only match if same entity (user) - different users can import same GitHub repo
        // Also check by ownerPubkey to catch duplicates even if entity format changed (8-char vs npub)
        const existingMatch = existingRepos.find((r: any) => {
          // Match by entity AND repo slug (same user, same repo name)
          const found = findRepoByEntityAndName(
            [r],
            entityInfo.entitySlug,
            repoSlug
          );
          if (found !== undefined) return true;

          // Match by ownerPubkey AND repo slug (catches duplicates even if entity format changed)
          if (
            pubkey &&
            r.ownerPubkey &&
            r.ownerPubkey.toLowerCase() === pubkey.toLowerCase()
          ) {
            const rRepo = (r.repo || r.slug || "").trim().toLowerCase();
            const newRepo = repoSlug.trim().toLowerCase();
            if (rRepo === newRepo || rRepo.endsWith(`/${newRepo}`)) {
              return true;
            }
          }

          // Also check by sourceUrl BUT only if same entity (prevent duplicate imports by same user)
          // Different users can import the same GitHub repo, so don't block that
          if (
            r.entity === entityInfo.entitySlug &&
            (r.sourceUrl === repo.html_url || r.forkedFrom === repo.html_url)
          ) {
            return true;
          }
          return false;
        });

        if (existingMatch) {
          console.log(`Skipping ${fullName} - already exists for this user:`, {
            existingEntity: existingMatch.entity,
            newEntity: entityInfo.entitySlug,
            existingRepo: existingMatch.repo,
            newRepo: repoSlug,
            existingSourceUrl: existingMatch.sourceUrl,
            newSourceUrl: repo.html_url,
            matchReason:
              existingMatch.entity === entityInfo.entitySlug &&
              existingMatch.repo === repoSlug
                ? "same entity and repo slug"
                : "same entity and sourceUrl",
          });
          skippedCount++;
          continue;
        }
        console.debug("✅ [Import] Preparing to import repo", {
          repoSlug,
          entity: entityInfo.entitySlug,
          repoName: repo.name,
        });

        try {
          // Import the repository via our API
          console.log(`📥 [Import] Fetching ${fullName} from ${repo.html_url}`);
          // Include GitHub token if available (for private repos)
          const githubToken = localStorage.getItem("gittr_github_token");
          const importResponse = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceUrl: repo.html_url,
              ...(githubToken ? { githubToken } : {}),
            }),
          });

          if (!importResponse.ok) {
            const errorBody = await importResponse.text();
            let errorMessage = `Failed to import ${fullName}: ${importResponse.status} ${importResponse.statusText}`;
            if (errorBody) {
              try {
                const errorJson = JSON.parse(errorBody);
                if (errorJson?.status === "repo_too_large") {
                  errorMessage =
                    errorJson.message ||
                    "Repository is too large to import. Please try importing a smaller repository or contact support.";
                } else if (errorJson?.message) {
                  errorMessage = errorJson.message;
                }
              } catch {
                errorMessage = errorBody;
              }
            }
            console.error(
              `❌ [Import] Failed to import ${fullName}:`,
              importResponse.status,
              errorMessage
            );
            setStatus(errorMessage);
            skippedCount++;
            continue;
          }

          const importData = await importResponse.json();
          console.debug("📦 [Import] API response summary", {
            status: importData.status,
            hasFiles: !!importData.files,
            filesType: typeof importData.files,
            filesIsArray: Array.isArray(importData.files),
            filesLength: importData.files?.length || 0,
            firstFewFiles: Array.isArray(importData.files)
              ? importData.files.slice(0, 3)
              : undefined,
          });
          if (importData.status === "repo_too_large") {
            const largeMessage =
              importData.message ||
              `Cannot import ${fullName}: repository is too large. Please try importing a smaller repository or contact support.`;
            console.warn("⚠️ [Import] Repo too large:", largeMessage);
            setStatus(largeMessage);
            skippedCount++;
            continue;
          }

          if (importData.status !== "completed") {
            console.error(
              `❌ [Import] Import failed for ${fullName}:`,
              importData.status,
              importData
            );
            if (importData.message) {
              setStatus(importData.message);
            }
            skippedCount++;
            continue;
          }

          // Verify files are present
          if (
            !importData.files ||
            !Array.isArray(importData.files) ||
            importData.files.length === 0
          ) {
            console.error(
              `❌ [Import] No files returned for ${fullName}`,
              importData
            );
          }

          // Map GitHub contributors to Nostr contributors
          // IMPORTANT: The importing Nostr user is the owner, not the GitHub owner
          let contributors: Array<{
            pubkey?: string;
            name?: string;
            picture?: string;
            weight: number;
            githubLogin?: string;
          }> = [];

          if (
            importData.contributors &&
            Array.isArray(importData.contributors) &&
            importData.contributors.length > 0
          ) {
            // CRITICAL: Query Nostr for GitHub identity mappings (NIP-39) before mapping contributors
            // This ensures GitHub users who have claimed their identity on Nostr are properly linked
            const githubLogins = importData.contributors
              .map((c: any) => c.login)
              .filter(Boolean);
            if (
              subscribe &&
              defaultRelays &&
              defaultRelays.length > 0 &&
              githubLogins.length > 0
            ) {
              try {
                const { queryGithubIdentitiesFromNostr } = await import(
                  "@/lib/github-mapping"
                );
                await queryGithubIdentitiesFromNostr(
                  subscribe,
                  defaultRelays,
                  githubLogins
                );
                console.log(
                  `✅ [Import] Queried Nostr for ${githubLogins.length} GitHub identities`
                );
              } catch (identityError) {
                console.warn(
                  "⚠️ [Import] Failed to query GitHub identities from Nostr:",
                  identityError
                );
                // Continue anyway - will use localStorage mappings only
              }
            }

            // CRITICAL: Keep ALL contributors (keepAnonymous: true) so GitHub users without Nostr pubkeys
            // are still shown with their GitHub avatars. This allows users to see both:
            // 1. GitHub contributors (with GitHub avatars) - even if they haven't claimed Nostr identities
            // 2. Nostr contributors (with Nostr avatars) - if they've claimed their GitHub identity
            contributors = mapGithubContributors(
              importData.contributors,
              pubkey || undefined,
              undefined,
              true
            );
          }

          // ALWAYS ensure the importing user (owner) is in contributors with weight 100
          // This is the Nostr user who imported, not the GitHub owner
          if (pubkey) {
            const ownerInList = contributors.some((c) => c.pubkey === pubkey);
            if (!ownerInList) {
              // Add owner at the beginning with weight 100
              contributors.unshift({
                pubkey: pubkey,
                name: entityInfo.displayName,
                weight: 100,
              });
            } else {
              // Ensure owner has weight 100
              const ownerIndex = contributors.findIndex(
                (c) => c.pubkey === pubkey
              );
              if (ownerIndex >= 0) {
                const owner = contributors[ownerIndex];
                if (owner) {
                  owner.weight = 100;
                  // Move owner to first position
                  contributors.splice(ownerIndex, 1);
                  contributors.unshift(owner);
                }
              }
            }
          } else if (contributors.length === 0) {
            // Fallback: create contributor entry without pubkey if user not logged in
            contributors = [{ name: entityInfo.displayName, weight: 100 }];
          }

          // Store in localStorage
          // IMPORTANT: For imports, the Nostr user doing the import is the owner
          // entity should be the Nostr user's pubkey (8-char prefix), and ownerPubkey should be set
          // Ensure contributors array has owner with pubkey FIRST
          let finalContributors = contributors;
          if (pubkey) {
            if (!finalContributors || !Array.isArray(finalContributors)) {
              finalContributors = [];
            }
            // Remove any existing owner entry
            finalContributors = finalContributors.filter(
              (c: any) =>
                !c.pubkey || c.pubkey.toLowerCase() !== pubkey.toLowerCase()
            );
            // Add owner at the beginning with weight 100
            finalContributors.unshift({
              pubkey: pubkey,
              name: entityInfo.displayName,
              weight: 100,
            });
          }

          // Build links array - add GitHub Pages/homepage if available
          const links: Array<{
            type:
              | "docs"
              | "discord"
              | "slack"
              | "youtube"
              | "twitter"
              | "github"
              | "other";
            url: string;
            label?: string;
          }> = [];
          if (
            importData.homepage &&
            typeof importData.homepage === "string" &&
            importData.homepage.trim().length > 0
          ) {
            // Add GitHub Pages/website link with "OPEN HERE" label
            links.push({
              type: "docs",
              url: importData.homepage.trim(),
              label: "OPEN HERE",
            });
          }

          // Store files separately to avoid localStorage quota issues
          // Store files in a separate key, only keep file count in main repo object
          let fileCount = 0;
          if (
            importData.files &&
            Array.isArray(importData.files) &&
            importData.files.length > 0
          ) {
            fileCount = importData.files.length;
            try {
              const filesKey = getRepoStorageKey(
                "gittr_files",
                entityNpub,
                repoSlug
              );
              localStorage.setItem(filesKey, JSON.stringify(importData.files));
            } catch (e) {
              console.error(
                `❌ [Import] Failed to save files separately for ${fullName}:`,
                e
              );
              // If separate storage fails, still try to store minimal file info
              fileCount = importData.files.length;
            }
          }

          const rec = {
            slug: repoSlug,
            entity: entityNpub, // Use npub format (GRASP protocol standard, matches URLs)
            entityDisplayName: entityInfo.displayName,
            repo: repoSlug,
            name: repo.name,
            sourceUrl: repo.html_url,
            forkedFrom: repo.html_url,
            readme: importData.readme,
            fileCount: fileCount, // Store only count, not full array
            description: importData.description || repo.description,
            stars: importData.stars || repo.stargazers_count,
            forks: importData.forks || repo.forks_count,
            languages: importData.languages || {},
            topics: importData.topics || repo.topics || [],
            contributors: finalContributors, // Use the properly formatted contributors
            defaultBranch: importData.defaultBranch || repo.default_branch,
            branches: importData.branches || [],
            tags: importData.tags || [],
            releases: importData.releases || [],
            // Don't store issues/pulls/commits in main repo object - they're stored separately
            links: links.length > 0 ? links : undefined, // Add links if homepage exists
            createdAt: Date.now(),
            ownerPubkey: pubkey || undefined, // Set importing user as owner (full pubkey)
          };
          // Log entity to verify it's correct
          console.log("🔄 [Import] Adding repo to existingRepos:", {
            entity: rec.entity,
            entityDisplayName: rec.entityDisplayName,
            ownerPubkey: rec.ownerPubkey?.slice(0, 8),
            expectedEntity: entityInfo.entitySlug,
            pubkey: pubkey?.slice(0, 8),
            repoName: rec.name,
            repoSlug: rec.repo,
            hasFiles: !!(rec.fileCount && rec.fileCount > 0),
            fileCount: rec.fileCount || 0,
            slug: rec.slug,
          });
          existingRepos.push(rec);
          importedCount++;

          // Save issues, pulls, and commits to separate localStorage keys for the issues/pulls/commits pages
          if (
            importData.issues &&
            Array.isArray(importData.issues) &&
            importData.issues.length > 0
          ) {
            try {
              const issuesKey = getRepoStorageKey(
                "gittr_issues",
                entityNpub,
                repoSlug
              );
              // Map GitHub issues to the format expected by the issues page
              const formattedIssues = importData.issues.map((issue: any) => ({
                id: `issue-${issue.number}`,
                entity: entityNpub,
                repo: repoSlug,
                title: issue.title || "",
                number: String(issue.number || ""),
                status: issue.state === "closed" ? "closed" : "open",
                author: issue.user?.login || "",
                labels: issue.labels?.map((l: any) => l.name || l) || [],
                assignees: [],
                createdAt: issue.created_at
                  ? new Date(issue.created_at).getTime()
                  : Date.now(),
                body: issue.body || "",
                html_url: issue.html_url || "",
              }));
              localStorage.setItem(issuesKey, JSON.stringify(formattedIssues));
            } catch (e) {
              console.error(
                `❌ [Import] Failed to save issues for ${fullName}:`,
                e
              );
            }
          }

          if (
            importData.pulls &&
            Array.isArray(importData.pulls) &&
            importData.pulls.length > 0
          ) {
            try {
              const pullsKey = getRepoStorageKey(
                "gittr_prs",
                entityNpub,
                repoSlug
              );
              // Map GitHub PRs to the format expected by the pulls page
              const formattedPRs = importData.pulls.map((pr: any) => ({
                id: `pr-${pr.number}`,
                entity: entityNpub,
                repo: repoSlug,
                title: pr.title || "",
                number: String(pr.number || ""),
                status: pr.merged_at
                  ? "merged"
                  : pr.state === "closed"
                  ? "closed"
                  : "open",
                author: pr.user?.login || "",
                labels: pr.labels?.map((l: any) => l.name || l) || [],
                assignees: [],
                createdAt: pr.created_at
                  ? new Date(pr.created_at).getTime()
                  : Date.now(),
                body: pr.body || "",
                html_url: pr.html_url || "",
                merged_at: pr.merged_at || null,
                head: pr.head?.ref || null,
                base: pr.base?.ref || null,
              }));
              localStorage.setItem(pullsKey, JSON.stringify(formattedPRs));
            } catch (e) {
              console.error(
                `❌ [Import] Failed to save pull requests for ${fullName}:`,
                e
              );
            }
          }

          if (
            importData.commits &&
            Array.isArray(importData.commits) &&
            importData.commits.length > 0
          ) {
            try {
              const commitsKey = getRepoStorageKey(
                "gittr_commits",
                entityNpub,
                repoSlug
              );
              // Map GitHub commits to the format expected by the commits page
              const formattedCommits = importData.commits.map(
                (commit: any) => ({
                  id: commit.sha || `commit-${Date.now()}`,
                  message: commit.message || "",
                  author: commit.author?.email || commit.committer?.email || "",
                  authorName:
                    commit.author?.name || commit.committer?.name || "",
                  timestamp:
                    commit.author?.date || commit.committer?.date
                      ? new Date(
                          commit.author?.date || commit.committer?.date
                        ).getTime()
                      : Date.now(),
                  branch: importData.defaultBranch || "main",
                  html_url: commit.html_url || "",
                })
              );
              localStorage.setItem(
                commitsKey,
                JSON.stringify(formattedCommits)
              );
            } catch (e) {
              console.error(
                `❌ [Import] Failed to save commits for ${fullName}:`,
                e
              );
            }
          }

          // Log tides repo structure immediately after adding
          if (repoSlug.toLowerCase() === "tides") {
            console.debug("🌊 [Import] Tides repo snapshot", {
              entity: rec.entity,
              entityLength: rec.entity?.length,
              ownerPubkey: rec.ownerPubkey?.slice(0, 16),
              ownerPubkeyLength: rec.ownerPubkey?.length,
              hasContributors: !!(
                rec.contributors && Array.isArray(rec.contributors)
              ),
              contributorsCount: rec.contributors?.length || 0,
              ownerContributor: rec.contributors?.find(
                (c: any) => c.weight === 100
              ),
              repo: rec.repo,
              slug: rec.slug,
              name: rec.name,
            });
          }

          // Record activity for fork/import (shows in history as first entry)
          if (pubkey) {
            try {
              recordActivity({
                type: "repo_imported",
                user: pubkey, // Use full pubkey for activity tracking
                repo: `${entityNpub}/${repoSlug}`,
                entity: entityNpub, // Use npub format (GRASP protocol standard)
                repoName: rec.name,
                metadata: {
                  sourceUrl: repo.html_url,
                  forkedFrom: repo.html_url,
                },
              });
              console.log(`📝 Recorded import activity for ${fullName}`);
            } catch (error) {
              console.error("Failed to record import activity:", error);
            }
          }

          // Publish to Nostr
          if (publish && pubkey) {
            try {
              const privateKey = await getNostrPrivateKey();
              if (privateKey) {
                // Get git server URL from env or use domain from env
                const domain =
                  process.env.NEXT_PUBLIC_DOMAIN ||
                  (typeof window !== "undefined" ? window.location.host : "");
                const gitServerUrl =
                  process.env.NEXT_PUBLIC_GIT_SERVER_URL ||
                  (domain
                    ? `https://${domain}`
                    : typeof window !== "undefined"
                    ? `${window.location.protocol}//${window.location.host}`
                    : "");

                const repoEvent = createRepositoryEvent(
                  {
                    repositoryName: repoSlug,
                    publicRead: (rec as any).publicRead !== false, // Preserve privacy status from import
                    publicWrite: false,
                    description:
                      rec.description || `Imported from ${repo.html_url}`,
                    sourceUrl: repo.html_url,
                    forkedFrom: repo.html_url,
                    readme: rec.readme,
                    // Files are stored separately - not included in event
                    stars: rec.stars,
                    forks: rec.forks,
                    languages: rec.languages,
                    topics: rec.topics,
                    contributors: rec.contributors,
                    defaultBranch: rec.defaultBranch,
                    branches: rec.branches,
                    releases: rec.releases,
                    // GRASP-01: Add clone and relays tags
                    clone: [gitServerUrl], // Git server URL where repo is hosted
                    relays: defaultRelays, // Nostr relays where repo events are published
                  },
                  privateKey
                );

                // Publish with confirmation and store event ID (for batch imports)
                try {
                  if (!publish || !subscribe) {
                    console.error(
                      `❌ [Import] Cannot publish ${fullName}: publish or subscribe is undefined`
                    );
                  } else {
                    const result = await publishWithConfirmation(
                      publish,
                      subscribe,
                      repoEvent,
                      defaultRelays,
                      10000 // 10 second timeout
                    );

                    if (result.confirmed) {
                      storeRepoEventId(
                        repoSlug,
                        rec.entity,
                        result.eventId,
                        true
                      );
                    } else {
                      storeRepoEventId(
                        repoSlug,
                        rec.entity,
                        result.eventId,
                        false
                      );
                    }
                  }
                } catch (pubError: any) {
                  console.error(
                    `❌ [Import] Failed to publish ${fullName} with confirmation:`,
                    pubError
                  );
                  // Mark repo as push_failed but keep it in localStorage
                  try {
                    const repos = JSON.parse(
                      localStorage.getItem("gittr_repos") || "[]"
                    );
                    const repoIndex = repos.findIndex(
                      (r: any) =>
                        (r.slug === repoSlug || r.repo === repoSlug) &&
                        r.entity === rec.entity
                    );
                    if (repoIndex >= 0) {
                      repos[repoIndex] = {
                        ...repos[repoIndex],
                        status: "push_failed",
                        pushError: pubError.message,
                      };
                      localStorage.setItem(
                        "gittr_repos",
                        JSON.stringify(repos)
                      );
                    }
                  } catch (e) {
                    console.error(
                      `Failed to mark ${fullName} as push_failed:`,
                      e
                    );
                  }
                }
              }
            } catch (error: any) {
              console.error(
                `❌ [Import] Failed to publish ${fullName} to Nostr:`,
                error
              );
              // Mark repo as push_failed but keep it in localStorage
              try {
                const repos = JSON.parse(
                  localStorage.getItem("gittr_repos") || "[]"
                );
                const repoIndex = repos.findIndex(
                  (r: any) =>
                    (r.slug === repoSlug || r.repo === repoSlug) &&
                    r.entity === rec.entity
                );
                if (repoIndex >= 0) {
                  repos[repoIndex] = {
                    ...repos[repoIndex],
                    status: "push_failed",
                    pushError: error.message,
                  };
                  localStorage.setItem("gittr_repos", JSON.stringify(repos));
                }
              } catch (e) {
                console.error(`Failed to mark ${fullName} as push_failed:`, e);
              }
            }
          } else {
          }
        } catch (error: any) {
          console.error(`Error importing ${fullName}:`, error);
          skippedCount++;
        }
      }

      console.log(
        `💾 [Import] Saving ${existingRepos.length} repos to localStorage (${importedCount} imported, ${skippedCount} skipped)`
      );

      // Clean up old repos before saving to avoid quota issues
      // Remove repos older than 90 days that haven't been updated
      const now = Date.now();
      const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
      const cleanedRepos = existingRepos.filter((r: any) => {
        // Keep repos that were created or updated in the last 90 days
        const lastActivity =
          r.updatedAt || r.lastModifiedAt || r.createdAt || 0;
        return lastActivity > ninetyDaysAgo;
      });

      if (cleanedRepos.length < existingRepos.length) {
        console.log(
          `🧹 [Import] Cleaned up ${
            existingRepos.length - cleanedRepos.length
          } old repos (older than 90 days)`
        );
      }

      // The repos are already correctly structured when added to existingRepos
      // Just ensure they're saved correctly
      try {
        localStorage.setItem("gittr_repos", JSON.stringify(cleanedRepos));
      } catch (e: any) {
        if (e.name === "QuotaExceededError" || e.message?.includes("quota")) {
          console.error(
            `❌ [Import] localStorage quota exceeded! Attempting cleanup...`
          );

          // More aggressive cleanup - remove repos older than 30 days
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          const aggressiveCleanup = cleanedRepos.filter((r: any) => {
            const lastActivity =
              r.updatedAt || r.lastModifiedAt || r.createdAt || 0;
            return lastActivity > thirtyDaysAgo;
          });

          try {
            localStorage.setItem(
              "gittr_repos",
              JSON.stringify(aggressiveCleanup)
            );
            console.log(
              `🧹 [Import] Aggressive cleanup: removed ${
                cleanedRepos.length - aggressiveCleanup.length
              } repos (older than 30 days)`
            );
            alert(
              `⚠️ localStorage quota exceeded. Cleaned up old repos. ${aggressiveCleanup.length} repos remaining.`
            );
          } catch (e2: any) {
            console.error(
              `❌ [Import] Still quota exceeded after cleanup!`,
              e2
            );
            alert(
              `❌ Error: localStorage is full. Please clear browser data or remove some repos manually.`
            );
            throw e2;
          }
        } else {
          throw e;
        }
      }

      // Verify save worked and log structure
      const savedRepos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      );
      const tidesInSaved = savedRepos.find((r: any) => {
        const repoName = r.repo || r.slug || r.name || "";
        return repoName.toLowerCase() === "tides";
      });
      if (tidesInSaved) {
        console.debug("🌊 [Import] Tides repo verified in localStorage", {
          entity: tidesInSaved.entity,
          entityLength: tidesInSaved.entity?.length,
          ownerPubkey: tidesInSaved.ownerPubkey?.slice(0, 16),
          ownerPubkeyLength: tidesInSaved.ownerPubkey?.length,
          hasContributors: !!(
            tidesInSaved.contributors &&
            Array.isArray(tidesInSaved.contributors)
          ),
          contributorsCount: tidesInSaved.contributors?.length || 0,
          ownerContributor: tidesInSaved.contributors?.find(
            (c: any) => c.weight === 100
          ),
          repo: tidesInSaved.repo,
          slug: tidesInSaved.slug,
          name: tidesInSaved.name,
        });
      } else {
        console.error(
          "❌ [Import] ERROR: tides repo NOT found in localStorage after save!"
        );
        console.error(
          "All saved repos:",
          savedRepos.map((r: any) => ({
            repo: r.repo,
            slug: r.slug,
            name: r.name,
            entity: r.entity,
          }))
        );
      }

      // Dispatch event to update repositories page
      // This works in the same tab (unlike StorageEvent which only fires in other tabs)
      // Dispatch event to trigger reload on repositories page
      window.dispatchEvent(
        new CustomEvent("gittr:repo-imported", {
          detail: { repos: existingRepos },
        })
      );

      setStatus(
        `Imported ${importedCount} repositories${
          skippedCount > 0 ? `, ${skippedCount} skipped (already exist)` : ""
        }`
      );

      // Navigate to repositories page after import completes
      if (importedCount > 0) {
        setTimeout(() => {
          router.push("/repositories");
        }, 500);
      }
    } catch (error: any) {
      setStatus(`Import error: ${error.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">Bulk Import from GitHub</h1>

      <div className="mb-6">
        <label className="block mb-2">GitHub Username or Profile URL</label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="flex-1 border border-[#383B42] bg-[#0E1116] text-white p-2 rounded"
            value={githubUrl}
            onChange={(e) => {
              setGithubUrl(e.target.value);
              // Clear the last fetched URL so it can fetch again if user changes input
              if (e.target.value.trim() !== lastFetchedUrlRef.current) {
                lastFetchedUrlRef.current = "";
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Clear debounce and fetch immediately
                if (debounceTimerRef.current) {
                  clearTimeout(debounceTimerRef.current);
                }
                fetchUserRepos();
              }
            }}
            placeholder="arbadacarbayk or github.com/arbadacarbayk"
            disabled={loading || importing}
          />
          <button
            className="border border-[#383B42] bg-[#22262C] text-white px-4 py-2 rounded hover:bg-[#2a2e34] disabled:opacity-50"
            onClick={fetchUserRepos}
            disabled={loading || importing}
          >
            {loading ? "Loading..." : "Fetch Repos"}
          </button>
        </div>
        <p className="text-sm text-gray-400 mt-1">
          Enter a GitHub username or profile URL. https:// will be added
          automatically.
        </p>
      </div>

      {status && (
        <div
          className={`mb-4 p-3 rounded ${
            status.includes("Error") || status.includes("Failed")
              ? "bg-red-900/20 border border-red-500"
              : "bg-[#22262C] border border-[#383B42]"
          }`}
        >
          <p className="text-sm">{status}</p>
        </div>
      )}

      {repos.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">
              {selectedRepos.size} of {repos.length} repositories selected
            </p>
            <button
              className="text-sm text-purple-400 hover:text-purple-300"
              onClick={toggleAll}
            >
              {selectedRepos.size === repos.length
                ? "Deselect All"
                : "Select All"}
            </button>
          </div>

          <div className="border border-[#383B42] rounded overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              {repos.map((repo) => (
                <div
                  key={repo.full_name}
                  className={`p-3 border-b border-[#383B42] last:border-b-0 hover:bg-[#22262C] cursor-pointer ${
                    selectedRepos.has(repo.full_name) ? "bg-purple-900/20" : ""
                  }`}
                  onClick={() => toggleRepo(repo.full_name)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedRepos.has(repo.full_name)}
                      onChange={() => toggleRepo(repo.full_name)}
                      className="mt-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{repo.name}</h3>
                        {repo.private && (
                          <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1 rounded">
                            Private
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-sm text-gray-400 mt-1">
                          {repo.description}
                        </p>
                      )}
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>⭐ {repo.stargazers_count}</span>
                        <span>🍴 {repo.forks_count}</span>
                        {repo.language && <span>{repo.language}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 border border-[#383B42] bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded disabled:opacity-50"
              onClick={importSelected}
              disabled={importing || selectedRepos.size === 0}
            >
              {importing
                ? `Importing ${selectedRepos.size} repositories...`
                : `Import ${selectedRepos.size} Selected Repositories`}
            </button>
            <button
              className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e34] text-white px-4 py-2 rounded disabled:opacity-50"
              onClick={() => setShowImportAllConfirm(true)}
              disabled={importing || repos.length === 0}
            >
              {importing ? "Importing All..." : "Import All"}
            </button>

            {/* Import All Confirmation Modal */}
            {showImportAllConfirm && (
              <div
                className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
                onClick={() => setShowImportAllConfirm(false)}
              >
                <div
                  className="bg-[#0E1116] border border-[#383B42] rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 className="text-xl font-bold mb-4 text-yellow-400">
                    ⚠️ Import All Repositories
                  </h2>

                  <div className="space-y-4 mb-6">
                    <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-4">
                      <p className="font-semibold text-yellow-300 mb-2">
                        What will be imported:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90">
                        <li>
                          <strong>{repos.length} repositories</strong> from{" "}
                          {githubUrl || "GitHub"}
                        </li>
                        <li>
                          All files, issues, PRs, and commits for each
                          repository
                        </li>
                        <li>
                          All data will be stored in your browser's localStorage
                        </li>
                      </ul>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-600/50 rounded p-4">
                      <p className="font-semibold text-blue-300 mb-2">
                        ⚠️ Important considerations:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90">
                        <li>This can take a long time for many repositories</li>
                        <li>
                          Large imports may cause browser slowdown or crashes
                        </li>
                        <li>
                          Closing the browser during import can corrupt
                          localStorage data
                        </li>
                        <li>You should be logged in with your Nostr key</li>
                      </ul>
                    </div>

                    <div className="bg-red-900/20 border border-red-600/50 rounded p-4">
                      <p className="font-semibold text-red-300 mb-2">
                        ⚠️ Warning:
                      </p>
                      <p className="text-sm text-red-200/90">
                        If you accidentally click this or close the browser
                        during import, you may end up with corrupted data in
                        localStorage. Make sure you have time to complete the
                        import process.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setShowImportAllConfirm(false)}
                      className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e35] px-4 py-2 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowImportAllConfirm(false);
                        // Select all repos and import
                        setSelectedRepos(
                          new Set(repos.map((r) => r.full_name))
                        );
                        // Use setTimeout to ensure state is updated before calling importSelected
                        setTimeout(() => {
                          importSelected();
                        }, 100);
                      }}
                      className="border border-yellow-500/50 bg-yellow-900/20 hover:bg-yellow-900/30 text-yellow-300 px-4 py-2 rounded transition-colors font-semibold"
                    >
                      Yes, Import All {repos.length} Repositories
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
