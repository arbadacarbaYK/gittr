/**
 * React Hook for Entity Owner Resolution
 *
 * Provides a consistent way to resolve entity owners and fetch their metadata
 * across all pages. Handles 8-char prefixes, full pubkeys, and repo ownership.
 */
import { useMemo } from "react";

import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";

import {
  getEntityDisplayName,
  getEntityPicture,
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "./entity-resolver";
import { findRepoByEntityAndName } from "./repo-finder";

interface UseEntityOwnerOptions {
  entity?: string;
  repo?: any;
  repos?: any[]; // For looking up repo if not provided
  repoName?: string; // For looking up repo if not provided
}

interface EntityOwnerResult {
  ownerPubkey: string | null;
  ownerDisplayName: string;
  ownerPicture: string | null;
  ownerMetadata: Record<string, any>;
  isLoading: boolean;
}

/**
 * Hook to resolve entity owner and fetch metadata
 *
 * @param options - Entity owner resolution options
 * @returns Entity owner information including pubkey, display name, picture, and metadata
 */
export function useEntityOwner(
  options: UseEntityOwnerOptions
): EntityOwnerResult {
  const { entity, repo: providedRepo, repos, repoName } = options;

  // Resolve repo if not provided
  const repo = useMemo(() => {
    if (providedRepo) return providedRepo;
    if (!repos || !entity || !repoName) return null;

    return findRepoByEntityAndName(repos, entity, repoName) || null;
  }, [providedRepo, repos, entity, repoName]);

  // Resolve owner pubkey
  // For foreign repos, repo might not be in localStorage yet, but we can still resolve from entity
  // The page component queries Nostr and saves ownerPubkey to localStorage, but layout might render before that
  const ownerPubkey = useMemo(() => {
    // Priority 1: If repo is provided and has ownerPubkey, use it
    if (repo) {
      const repoOwnerPubkey = getRepoOwnerPubkey(repo, entity);
      if (repoOwnerPubkey) return repoOwnerPubkey;
    }

    // Priority 2: Try to resolve from entity (works even if repo is null - for foreign repos)
    // This checks localStorage for activities and cached repos from explore page
    if (entity) {
      const resolved = resolveEntityToPubkey(entity, repo);
      if (resolved) return resolved;
    }

    return null;
  }, [repo, entity]);

  // Fetch owner metadata
  const ownerPubkeysForMetadata = useMemo(() => {
    return ownerPubkey ? [ownerPubkey] : [];
  }, [ownerPubkey]);

  const ownerMetadata = useContributorMetadata(ownerPubkeysForMetadata);

  // Get display name and picture
  const ownerDisplayName = useMemo(() => {
    return getEntityDisplayName(ownerPubkey, ownerMetadata, entity);
  }, [ownerPubkey, ownerMetadata, entity]);

  const ownerPicture = useMemo(() => {
    return getEntityPicture(ownerPubkey, ownerMetadata);
  }, [ownerPubkey, ownerMetadata]);

  const isLoading = useMemo(() => {
    return ownerPubkey !== null && !ownerMetadata[ownerPubkey];
  }, [ownerPubkey, ownerMetadata]);

  return {
    ownerPubkey,
    ownerDisplayName,
    ownerPicture,
    ownerMetadata,
    isLoading,
  };
}
