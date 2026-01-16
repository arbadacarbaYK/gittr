// Repository subscription from Nostr relays
// Subscribes to repository events and syncs local storage
import { useEffect } from "react";

import { useNostrContext } from "./NostrContext";
import { KIND_REPOSITORY } from "./events";

export interface RepoSubscriptionOptions {
  onRepoReceived?: (repo: any) => void;
  onError?: (error: Error) => void;
}

// Subscribe to repository events from Nostr relays
export function useRepoSubscription(options: RepoSubscriptionOptions = {}) {
  const { subscribe, defaultRelays } = useNostrContext();

  useEffect(() => {
    if (!subscribe) return;

    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY],
          limit: 10000, // Request up to 10k repos (most relays default to 100-500 without this)
          // Subscribe to all repos or filter by authors
          // For now, subscribe to all repos
        },
      ],
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        if (!isAfterEose && event.kind === KIND_REPOSITORY) {
          try {
            const repoData = JSON.parse(event.content);

            // Store repo in local storage
            const repos = JSON.parse(
              localStorage.getItem("gittr_repos") || "[]"
            );
            const repoId = `${event.pubkey}/${repoData.repositoryName}`;

            const existingIndex = repos.findIndex(
              (r: any) =>
                r.entity === event.pubkey && r.repo === repoData.repositoryName
            );

            // Merge with existing data if it exists, preserving local-only data like logoUrl
            const existingRepo =
              existingIndex >= 0 ? repos[existingIndex] : undefined;

            const repo = {
              slug: repoData.repositoryName,
              entity: event.pubkey,
              entityDisplayName: event.pubkey.slice(0, 8), // Fallback - will be updated from metadata
              repo: repoData.repositoryName,
              name: repoData.repositoryName,
              description: repoData.description,
              publicRead: repoData.publicRead,
              publicWrite: repoData.publicWrite,
              zapPolicy: repoData.zapPolicy,
              // Sync ALL extended metadata from Nostr
              sourceUrl: repoData.sourceUrl || existingRepo?.sourceUrl,
              forkedFrom: repoData.forkedFrom || existingRepo?.forkedFrom,
              readme: repoData.readme || existingRepo?.readme,
              files: repoData.files || existingRepo?.files,
              stars:
                repoData.stars !== undefined
                  ? repoData.stars
                  : existingRepo?.stars,
              forks:
                repoData.forks !== undefined
                  ? repoData.forks
                  : existingRepo?.forks,
              languages: repoData.languages || existingRepo?.languages,
              topics: repoData.topics || existingRepo?.topics,
              contributors: repoData.contributors || existingRepo?.contributors,
              defaultBranch:
                repoData.defaultBranch || existingRepo?.defaultBranch,
              branches: repoData.branches || existingRepo?.branches,
              releases: repoData.releases || existingRepo?.releases,
              logoUrl: existingRepo?.logoUrl, // Preserve local-only data
              createdAt: existingRepo?.createdAt || event.created_at * 1000,
              updatedAt: event.created_at * 1000,
            };

            if (existingIndex >= 0) {
              repos[existingIndex] = { ...existingRepo, ...repo };
            } else {
              repos.push(repo);
            }

            localStorage.setItem("gittr_repos", JSON.stringify(repos));

            if (options.onRepoReceived) {
              options.onRepoReceived(repo);
            }
          } catch (error: any) {
            if (options.onError) {
              options.onError(error);
            }
          }
        }
      }
    );

    return () => {
      unsub();
    };
  }, [subscribe, defaultRelays, options.onRepoReceived, options.onError]);
}
