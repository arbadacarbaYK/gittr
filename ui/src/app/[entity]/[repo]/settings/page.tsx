"use client";

import { useEffect, useState } from "react";
import SettingsHero from "@/components/settings-hero";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { createRepositoryEvent, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { useParams, useRouter } from "next/navigation";
import { Zap, ArrowRight, CheckCircle, X, Plus, User, Lock, Globe, BookOpen, MessageSquare, Youtube, Twitter, Github, Link as LinkIcon } from "lucide-react";
import DistributeZaps from "@/components/ui/distribute-zaps";
import { getAccumulatedZaps, recordAccumulatedZap } from "@/lib/payments/zap-repo";
import RepoWalletConfig from "./RepoWalletConfig";
import { Textarea } from "@/components/ui/textarea";
import { normalizeUrlOnBlur } from "@/lib/utils/url-normalize";
import { getRepoStorageKey, normalizeEntityForStorage } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, saveStoredRepos, type StoredRepo, type StoredContributor } from "@/lib/repos/storage";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { RepoLink } from "@/components/ui/repo-links";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";
import { isOwner, canManageSettings } from "@/lib/repo-permissions";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";

interface ZapSplit {
  pubkey: string;
  weight: number; // percentage 0-100
}

interface Milestone {
  id: string;
  name: string;
  description?: string;
  dueDate?: number;
}

export default function RepoSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { publish, defaultRelays, pubkey } = useNostrContext();
  const entity = params?.entity as string;
  const repo = params?.repo as string;
  
  const [isOwnerUser, setIsOwnerUser] = useState(false);
  const [loadingOwnerCheck, setLoadingOwnerCheck] = useState(true);
  
  // CRITICAL: Settings page is owner-only - check access on mount
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      
      if (repoData && pubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(repoData, entity);
        const userIsOwner = isOwner(pubkey, repoData.contributors, repoOwnerPubkey);
        const canManage = canManageSettings(
          repoData.contributors?.find((c: StoredContributor) => 
            c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase()
          ) || null
        );
        
        setIsOwnerUser(userIsOwner || canManage);
      } else {
        setIsOwnerUser(false);
      }
    } catch {
      setIsOwnerUser(false);
    } finally {
      setLoadingOwnerCheck(false);
    }
  }, [entity, repo, pubkey]);
  
  // Redirect non-owners away from settings
  useEffect(() => {
    if (!loadingOwnerCheck && !isOwnerUser && pubkey) {
      // User is logged in but not owner - redirect to repo page
      router.push(`/${entity}/${repo}`);
    }
  }, [loadingOwnerCheck, isOwnerUser, entity, repo, pubkey, router]);
  
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [zapSplits, setZapSplits] = useState<ZapSplit[]>([]);
  const [splitPubkey, setSplitPubkey] = useState("");
  const [splitWeight, setSplitWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [logoInput, setLogoInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [milestoneDueDate, setMilestoneDueDate] = useState("");
  const [accumulatedZaps, setAccumulatedZaps] = useState<Array<{
    amount: number;
    paymentHash: string;
    comment?: string;
    createdAt: number;
    status: "received" | "split";
  }>>([]);
  const [repoWalletConfig, setRepoWalletConfig] = useState<{
    lnurl?: string;
    lnaddress?: string;
    nwcRecv?: string;
    lnbitsUrl?: string;
    lnbitsAdminKey?: string;
    nwcSend?: string;
  }>({});
  const [requiredApprovals, setRequiredApprovals] = useState<number>(1);
  const [gitSshBase, setGitSshBase] = useState("");
  const [owners, setOwners] = useState<Array<{ pubkey: string; name?: string; weight: number; role: "owner" }>>([]);
  const [maintainers, setMaintainers] = useState<Array<{ pubkey: string; name?: string; weight: number; role: "maintainer" }>>([]);
  const [newOwnerInput, setNewOwnerInput] = useState("");
  const [newMaintainerInput, setNewMaintainerInput] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [repoLinks, setRepoLinks] = useState<RepoLink[]>([]);
  const [newLinkType, setNewLinkType] = useState<RepoLink["type"]>("docs");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");

  useEffect(() => {
    // Load repo data
    try {
      const repos = loadStoredRepos();
      const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      
      if (repoData) {
        const repoWithExtras = repoData as StoredRepo & {
          zapPolicy?: { splits?: ZapSplit[] };
          logoUrl?: string;
          requiredApprovals?: number;
          walletConfig?: typeof repoWalletConfig;
          gitSshBase?: string;
          publicRead?: boolean;
          publicWrite?: boolean;
        };
        setDescription(repoData.description || "");
        setTags(repoData.topics || []);
        setZapSplits(repoWithExtras.zapPolicy?.splits || []);
        setLogoInput(repoWithExtras.logoUrl || "");
        setRequiredApprovals(repoWithExtras.requiredApprovals || 1);
        // Load repo wallet config
        setRepoWalletConfig(repoWithExtras.walletConfig || {});
        // Load gitSshBase
        setGitSshBase(repoWithExtras.gitSshBase || process.env.NEXT_PUBLIC_GIT_SSH_BASE || "");
        // Load visibility (default to public if not set)
        setIsPublic(repoWithExtras.publicRead !== undefined ? repoWithExtras.publicRead : true);
        // Load owners (role: "owner" or weight: 100)
        const ownersList = (repoData.contributors || []).filter((c: StoredContributor): c is StoredContributor & { pubkey: string } => 
          (c.role === "owner" || (c.role === undefined && c.weight === 100)) && !!c.pubkey
        );
        setOwners(ownersList.length > 0 
          ? ownersList.map((o) => ({ pubkey: o.pubkey, name: o.name, weight: o.weight ?? 100, role: "owner" as const }))
          : (repoData.ownerPubkey ? [{ pubkey: repoData.ownerPubkey, weight: 100, role: "owner" as const }] : [])
        );
        
        // Load maintainers (role: "maintainer" or weight: 50-99)
        const maintainersList = (repoData.contributors || []).filter((c: StoredContributor): c is StoredContributor & { pubkey: string } => 
          (c.role === "maintainer" || (c.role === undefined && c.weight !== undefined && c.weight >= 50 && c.weight < 100)) && !!c.pubkey
        );
        setMaintainers(maintainersList.map((m) => ({ pubkey: m.pubkey, name: m.name, weight: m.weight ?? 50, role: "maintainer" as const })));
        // Load repo links
        setRepoLinks(repoData.links || []);
      }
      
      // Load accumulated zaps
      const repoId = `${entity}/${repo}`;
      setAccumulatedZaps(getAccumulatedZaps(repoId));
      
      // Load milestones
      try {
        const milestonesKey = getRepoStorageKey("gittr_milestones", entity, repo);
        const loaded = JSON.parse(localStorage.getItem(milestonesKey) || "[]") as Milestone[];
        setMilestones(loaded);
      } catch {
        setMilestones([]);
      }
    } catch {}
  }, [entity, repo]);

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleAddSplit = () => {
    if (splitPubkey && splitWeight) {
      const weight = parseInt(splitWeight);
      if (weight > 0 && weight <= 100) {
        const totalWeight = zapSplits.reduce((sum, s) => sum + s.weight, 0);
        if (totalWeight + weight <= 100) {
          setZapSplits([...zapSplits, { pubkey: splitPubkey.trim(), weight }]);
          setSplitPubkey("");
          setSplitWeight("");
        } else {
          setStatus("Total split weights cannot exceed 100%");
        }
      }
    }
  };

  const handleRemoveSplit = (pubkey: string) => {
    setZapSplits(zapSplits.filter(s => s.pubkey !== pubkey));
  };

  const handleSave = async () => {
    // CRITICAL: Only owners can save settings
    if (!isOwnerUser) {
      alert("Only repository owners can save settings");
      return;
    }
    
    setSaving(true);
    setStatus("");

    try {
      // CRITICAL: Require signature for settings changes (owner must sign)
      const privateKey = await getNostrPrivateKey();
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      
      if (!privateKey && !hasNip07) {
        alert("Saving settings requires signature. Please configure NIP-07 extension or private key in settings.");
        setSaving(false);
        return;
      }

      // Update local storage
      const repos = loadStoredRepos();
      const repoIndex = repos.findIndex((r: StoredRepo) => {
        const found = findRepoByEntityAndName<StoredRepo>([r], entity, repo);
        return found !== undefined;
      });
      
      if (repoIndex >= 0 && repos[repoIndex]) {
        // Update contributors: ensure all owners are in contributors with weight 100
        const existingContributors = repos[repoIndex].contributors || [];
        const ownerPubkeys = owners.map(o => o.pubkey);
        
        // Remove old owners from contributors (weight 100) that are not in new owners list
        const contributorsWithoutOldOwners = existingContributors.filter((c: StoredContributor) => 
          c.weight !== 100 || (c.pubkey && ownerPubkeys.includes(c.pubkey))
        );
        
        // Add all owners as contributors with weight 100
        const updatedContributors = [
          ...owners.map(o => ({
            pubkey: o.pubkey,
            name: ownerMetadata[o.pubkey]?.display_name || ownerMetadata[o.pubkey]?.name || o.name,
            weight: 100,
          })),
          ...contributorsWithoutOldOwners.filter((c: StoredContributor) => c.weight !== 100),
        ];
        
        repos[repoIndex] = {
          ...repos[repoIndex],
          description,
          topics: tags,
          zapPolicy: zapSplits.length > 0 ? { splits: zapSplits } : undefined,
          logoUrl: logoInput ? (logoInput.trim() || undefined) : undefined,
          walletConfig: Object.keys(repoWalletConfig).length > 0 ? repoWalletConfig : undefined,
          gitSshBase: gitSshBase || undefined,
          requiredApprovals: requiredApprovals,
          contributors: updatedContributors,
          ownerPubkey: owners[0]?.pubkey || repos[repoIndex].ownerPubkey, // First owner is primary
          publicRead: isPublic,
          publicWrite: false, // Repos are read-only for non-owners
          links: repoLinks.length > 0 ? repoLinks : undefined,
        } as StoredRepo & {
          publicRead?: boolean;
          publicWrite?: boolean;
          zapPolicy?: { splits?: ZapSplit[] };
          logoUrl?: string;
          walletConfig?: typeof repoWalletConfig;
          gitSshBase?: string;
          requiredApprovals?: number;
        };
        // Assign runtime properties separately
        const repoWithExtras = repos[repoIndex] as StoredRepo & {
          publicRead?: boolean;
          publicWrite?: boolean;
          zapPolicy?: { splits?: ZapSplit[] };
          logoUrl?: string;
          walletConfig?: typeof repoWalletConfig;
          gitSshBase?: string;
          requiredApprovals?: number;
        };
        repoWithExtras.publicRead = isPublic;
        repoWithExtras.publicWrite = false; // Repos are read-only for non-owners
        repoWithExtras.zapPolicy = zapSplits.length > 0 ? { splits: zapSplits } : undefined;
        repoWithExtras.logoUrl = logoInput ? (logoInput.trim() || undefined) : undefined;
        repoWithExtras.walletConfig = Object.keys(repoWalletConfig).length > 0 ? repoWalletConfig : undefined;
        repoWithExtras.gitSshBase = gitSshBase || undefined;
        repoWithExtras.requiredApprovals = requiredApprovals;
        saveStoredRepos(repos);
        
        // Mark repo as having unpushed edits if it was previously live
        if (repos[repoIndex].lastNostrEventId || repos[repoIndex].nostrEventId || repos[repoIndex].syncedFromNostr) {
          const { markRepoAsEdited } = await import("@/lib/utils/repo-status");
          markRepoAsEdited(repo, entity);
        }
        
        // Trigger event to notify repo page to reload
        window.dispatchEvent(new Event("gittr:repo-updated"));
      }
      
      // Save milestones
      try {
        const milestonesKey = `gittr_milestones_${entity}_${repo}`;
        localStorage.setItem(milestonesKey, JSON.stringify(milestones));
      } catch {}

      // Publish updated repository event to Nostr (optional)
      if (publish && pubkey && privateKey) {
        const repoEvent = createRepositoryEvent(
          {
            repositoryName: repo,
            publicRead: isPublic,
            publicWrite: false,
            description,
            tags,
            zapPolicy: zapSplits.length > 0 ? { splits: zapSplits } : undefined,
            requiredApprovals: requiredApprovals,
            links: repoLinks.length > 0 ? repoLinks : undefined,
          },
          privateKey
        );

        publish(repoEvent, defaultRelays);
        setStatus("Settings saved and published to Nostr!");
      } else {
        setStatus("Settings saved");
      }
      
      // Navigate back to repo page after showing success message
      setTimeout(() => {
        router.push(`/${entity}/${repo}`);
      }, 1500);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRepo = async () => {
    // CRITICAL: Only owners can delete repositories
    if (!isOwnerUser) {
      alert("Only repository owners can delete repositories");
      return;
    }
    
    if (!confirm(`Delete repository ${entity}/${repo}? This cannot be undone.\n\nNote: If this repo was published to Nostr, a deletion marker will be published to notify other clients. The repo will be hidden from your local view and won't be re-added when syncing from Nostr.`)) return;
    
    // CRITICAL: Require signature for deletion (owner must sign)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;
    
    if (!privateKey && !hasNip07) {
      alert("Deleting repositories requires signature. Please configure NIP-07 extension or private key in settings.");
      return;
    }
    
    try {
      setDeleting(true);
      const repos = loadStoredRepos();
      
      // Find the repo to get its full data for deletion event
      const repoToDelete = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      
      // Match by entity (exact) or slug (if entity is slug) or ownerPubkey
      // Also match by repo name exactly
      const next = repos.filter((r: StoredRepo) => {
        const found = findRepoByEntityAndName<StoredRepo>([r], entity, repo);
        return found === undefined; // Keep repos that DON'T match
      });
      
      saveStoredRepos(next);
      
      // CRITICAL: Publish deletion marker to Nostr (if repo was published)
      // This notifies other clients that the owner has deleted the repo
      // Only publish if repo was actually committed to Nostr (has event ID)
      const wasPublishedToNostr = repoToDelete && (
        (repoToDelete as any).lastNostrEventId || 
        (repoToDelete as any).nostrEventId || 
        (repoToDelete as any).syncedFromNostr
      );
      
      // CRITICAL: Publish deletion marker to Nostr (non-blocking)
      // Don't wait for publish to complete - local deletion is done, button should be re-enabled
      if (publish && pubkey && repoToDelete && wasPublishedToNostr) {
        // Publish deletion marker in background (non-blocking)
        // This ensures the button is re-enabled immediately after local deletion
        (async () => {
          try {
            // Sign with NIP-07 or private key
            const hasNip07 = typeof window !== "undefined" && window.nostr;
            const privateKey = hasNip07 ? null : await getNostrPrivateKey();
            
            if (hasNip07 || privateKey) {
              // Publish a replacement event with deleted: true
              // This uses the same "d" tag, so it replaces the previous event (NIP-34 replaceable events)
              const repoWithExtras = repoToDelete as StoredRepo & {
                publicRead?: boolean;
                sourceUrl?: string;
                forkedFrom?: string;
              };
              
              let deletionEvent: any;
              if (hasNip07 && window.nostr) {
                // Use NIP-07 (supports remote signer)
                // CRITICAL: Add timeout for mobile NIP-07 signing (can hang)
                const { getEventHash } = await import("nostr-tools");
                const authorPubkey = await window.nostr.getPublicKey();
                deletionEvent = {
                  kind: KIND_REPOSITORY_NIP34,
                  created_at: Math.floor(Date.now() / 1000),
                  tags: [
                    ["d", repo],
                    ["name", repo],
                    ...(repoWithExtras.description ? [["description", repoWithExtras.description]] : []),
                    ...(repoWithExtras.sourceUrl ? [["source", repoWithExtras.sourceUrl]] : []),
                    ...(repoWithExtras.forkedFrom ? [["forkedFrom", repoWithExtras.forkedFrom]] : []),
                  ],
                  content: JSON.stringify({
                    deleted: true,
                    publicRead: repoWithExtras.publicRead !== false,
                    publicWrite: false,
                  }),
                  pubkey: authorPubkey,
                  id: "",
                  sig: "",
                };
                deletionEvent.id = getEventHash(deletionEvent);
                
                // CRITICAL: Add timeout for NIP-07 signing on mobile (can hang)
                const signPromise = window.nostr.signEvent(deletionEvent);
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error("Signing timeout - please try again")), 30000)
                );
                deletionEvent = await Promise.race([signPromise, timeoutPromise]);
              } else if (privateKey) {
                // Use private key (fallback)
                deletionEvent = createRepositoryEvent(
                  {
                    repositoryName: repo,
                    publicRead: repoWithExtras.publicRead !== false,
                    publicWrite: false,
                    description: repoToDelete.description,
                    deleted: true, // Mark as deleted on Nostr - other clients will respect this
                    // Preserve other metadata for context
                    sourceUrl: repoWithExtras.sourceUrl,
                    forkedFrom: repoWithExtras.forkedFrom,
                  },
                  privateKey
                );
              } else {
                throw new Error("No signing method available");
              }
              
              // CRITICAL: Don't await publish - make it non-blocking
              // Local deletion is complete, button should be re-enabled
              try {
                publish(deletionEvent, defaultRelays);
                console.log("✅ Published deletion marker to Nostr - other clients will hide this repo");
              } catch (error: any) {
                console.error("Failed to publish deletion marker to Nostr:", error);
                // Local deletion is already done, so this is just a warning
              }
            }
          } catch (error: any) {
            console.error("Failed to create/publish deletion marker to Nostr:", error);
            // Continue - local deletion is already done
          }
        })();
      } else if (repoToDelete && !wasPublishedToNostr) {
        console.log("ℹ️ Repo was not published to Nostr, skipping deletion event");
      }
      
      // CRITICAL: Mark repo as locally deleted so it won't be re-added from Nostr sync
      // Store deletion with BOTH entity (npub) and ownerPubkey for robust matching
      const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number; ownerPubkey?: string}>;
      const deletedRepoKey = `${entity}/${repo}`.toLowerCase();
      
      // Get ownerPubkey if available (for robust matching during sync)
      const ownerPubkey = repoToDelete?.ownerPubkey || pubkey;
      
      // Check if already in deleted list (by entity/repo or by ownerPubkey/repo)
      const alreadyDeleted = deletedRepos.some(d => {
        const dKey = `${d.entity}/${d.repo}`.toLowerCase();
        if (dKey === deletedRepoKey) return true;
        // Also check by ownerPubkey if available (most reliable)
        if (ownerPubkey && d.ownerPubkey && d.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase()) {
          return d.repo.toLowerCase() === repo.toLowerCase();
        }
        return false;
      });
      
      if (!alreadyDeleted) {
        deletedRepos.push({
          entity: entity,
          repo: repo,
          deletedAt: Date.now(),
          ownerPubkey: ownerPubkey, // Store ownerPubkey for robust matching
        });
        localStorage.setItem("gittr_deleted_repos", JSON.stringify(deletedRepos));
        console.log(`✅ Marked repo as locally deleted: ${deletedRepoKey} (ownerPubkey: ${ownerPubkey?.slice(0, 16)}...)`);
      }
      
      // Clean all possible localStorage keys related to this repo
      const normalizedEntity = normalizeEntityForStorage(entity);
      const keyVariations = [
        `${normalizedEntity}__${repo}`,
        `${normalizedEntity}_${repo}`,
      ];
      
      // Clean overrides, deleted caches, PRs, Issues, etc.
      keyVariations.forEach(keyBase => {
        localStorage.removeItem(`gittr_repo_overrides__${keyBase}`);
        localStorage.removeItem(`gittr_repo_deleted__${keyBase}`);
        localStorage.removeItem(`gittr_prs__${keyBase}`);
        localStorage.removeItem(`gittr_issues__${keyBase}`);
        localStorage.removeItem(`gittr_milestones_${keyBase}`);
        localStorage.removeItem(`gittr_discussions__${keyBase}`);
        localStorage.removeItem(`gittr_releases__${keyBase}`);
      });
      
      // Also try with entity/repo format
      const zapRepoKey = `${entity}/${repo}`;
      localStorage.removeItem(`gittr_accumulated_zaps_${zapRepoKey}`);
      
      // CRITICAL: Re-enable button immediately after local deletion is complete
      // Nostr publish is non-blocking, so don't wait for it
      setDeleting(false);
      setStatus("Repository deleted successfully");
      
      // Navigate away after a short delay to show success message
      setTimeout(() => {
        window.location.href = "/repositories";
      }, 1000);
    } catch (e) {
      console.error("Delete error:", e);
      setDeleting(false);
      setStatus(`Failed to delete repository: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Get owner and maintainer metadata for display
  const ownerPubkeys = useMemo(() => {
    return owners.map(o => o.pubkey).filter(Boolean);
  }, [owners]);
  const maintainerPubkeys = useMemo(() => {
    return maintainers.map(m => m.pubkey).filter(Boolean);
  }, [maintainers]);
  const allRolePubkeys = useMemo(() => {
    return [...ownerPubkeys, ...maintainerPubkeys];
  }, [ownerPubkeys, maintainerPubkeys]);
  const ownerMetadata = useContributorMetadata(allRolePubkeys);
  
  // Get entity display name (use first owner's name or fallback to entity)
  const entityDisplayName = useMemo(() => {
    if (owners.length > 0 && owners[0]?.pubkey) {
      const meta = ownerMetadata[owners[0].pubkey];
      return meta?.display_name || meta?.name || owners[0].name || entity;
    }
    // Try to resolve from repo data
    try {
      const repos = loadStoredRepos();
      const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      if (repoData?.entityDisplayName) return repoData.entityDisplayName;
      if (repoData?.ownerPubkey) {
        const meta = ownerMetadata[repoData.ownerPubkey];
        return meta?.display_name || meta?.name || entity;
      }
    } catch {}
    return entity;
  }, [entity, repo, owners, ownerMetadata]);

  const handleAddOwner = () => {
    if (!newOwnerInput.trim()) return;
    
    // Try to decode npub or use as-is if it's a pubkey
    let pubkey = newOwnerInput.trim();
    try {
      if (pubkey.startsWith("npub")) {
        const { nip19 } = require("nostr-tools");
        const decoded = nip19.decode(pubkey);
        pubkey = decoded.data as string;
      }
    } catch {}
    
    // Validate pubkey
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      setStatus("Error: Invalid pubkey or npub");
      return;
    }
    
    // Check if already an owner
    if (owners.some(o => o.pubkey === pubkey)) {
      setStatus("Error: User is already an owner");
      return;
    }
    
    // Check if already a maintainer
    if (maintainers.some(m => m.pubkey === pubkey)) {
      setStatus("Error: User is already a maintainer. Remove from maintainers first.");
      return;
    }
    
    // Add owner
    setOwners([...owners, { pubkey, weight: 100, role: "owner" }]);
    setNewOwnerInput("");
    setStatus("Owner added (save to persist)");
  };

  const handleRemoveOwner = (pubkeyToRemove: string) => {
    // Don't allow removing the last owner
    if (owners.length <= 1) {
      setStatus("Error: Cannot remove the last owner");
      return;
    }
    
    // Don't allow removing yourself
    if (pubkeyToRemove === pubkey) {
      setStatus("Error: Cannot remove yourself as owner");
      return;
    }
    
    setOwners(owners.filter(o => o.pubkey !== pubkeyToRemove));
    setStatus("Owner removed (save to persist)");
  };

  const handleAddMaintainer = () => {
    if (!newMaintainerInput.trim()) return;
    
    // Try to decode npub or use as-is if it's a pubkey
    let pubkey = newMaintainerInput.trim();
    try {
      if (pubkey.startsWith("npub")) {
        const { nip19 } = require("nostr-tools");
        const decoded = nip19.decode(pubkey);
        pubkey = decoded.data as string;
      }
    } catch {}
    
    // Validate pubkey
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      setStatus("Error: Invalid pubkey or npub");
      return;
    }
    
    // Check if already an owner
    if (owners.some(o => o.pubkey === pubkey)) {
      setStatus("Error: User is already an owner");
      return;
    }
    
    // Check if already a maintainer
    if (maintainers.some(m => m.pubkey === pubkey)) {
      setStatus("Error: User is already a maintainer");
      return;
    }
    
    // Add maintainer
    setMaintainers([...maintainers, { pubkey, weight: 50, role: "maintainer" }]);
    setNewMaintainerInput("");
    setStatus("Maintainer added (save to persist)");
  };

  const handleRemoveMaintainer = (pubkeyToRemove: string) => {
    setMaintainers(maintainers.filter(m => m.pubkey !== pubkeyToRemove));
    setStatus("Maintainer removed (save to persist)");
  };

  const handleAddLink = () => {
    if (!newLinkUrl.trim()) {
      setStatus("Error: URL is required");
      return;
    }
    
    // Normalize URL (add https:// if missing)
    let normalizedUrl = newLinkUrl.trim();
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    // Validate URL format
    try {
      new URL(normalizedUrl);
    } catch {
      setStatus("Error: Invalid URL format");
      return;
    }
    
    const newLink: RepoLink = {
      type: newLinkType,
      url: normalizedUrl,
      label: newLinkLabel.trim() || undefined,
    };
    
    setRepoLinks([...repoLinks, newLink]);
    setNewLinkUrl("");
    setNewLinkLabel("");
    setNewLinkType("docs");
    setStatus("Link added (save to persist)");
  };

  const handleRemoveLink = (index: number) => {
    setRepoLinks(repoLinks.filter((_, i) => i !== index));
    setStatus("Link removed (save to persist)");
  };

  // Show loading state while checking owner status
  if (loadingOwnerCheck) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <SettingsHero title={`${entityDisplayName}/${repo} Settings`} />
        <div className="mt-4 text-center text-gray-400">Checking access...</div>
      </div>
    );
  }
  
  // Show access denied for non-owners (if logged in)
  if (!isOwnerUser && pubkey) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <SettingsHero title={`${entityDisplayName}/${repo} Settings`} />
        <div className="mt-4 p-6 border border-red-500/50 bg-red-900/20 rounded">
          <h2 className="text-xl font-semibold text-red-400 mb-2">Access Denied</h2>
          <p className="text-gray-300">
            Only repository owners can access settings. You will be redirected to the repository page.
          </p>
        </div>
      </div>
    );
  }
  
  // Show login prompt for non-logged-in users
  if (!pubkey) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <SettingsHero title={`${entityDisplayName}/${repo} Settings`} />
        <div className="mt-4 p-6 border border-yellow-500/50 bg-yellow-900/20 rounded">
          <h2 className="text-xl font-semibold text-yellow-400 mb-2">Login Required</h2>
          <p className="text-gray-300">
            Please log in to access repository settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <SettingsHero title={`${entityDisplayName}/${repo} Settings`} />
      
      <div className="mt-6 space-y-6">
        <div>
          <Label htmlFor="logo">Repository picture (URL or path in repo)</Label>
          <Input
            id="logo"
            value={logoInput}
            onChange={(e) => setLogoInput(e.target.value)}
            onBlur={(e) => {
              const normalized = normalizeUrlOnBlur(e.target.value);
              if (normalized !== e.target.value) {
                setLogoInput(normalized);
              }
            }}
            placeholder="example.com/logo.png or https://..."
            className="mt-2"
          />
          <p className="text-xs text-gray-400 mt-1">If empty, we auto-detect a file named logo.(png|jpg|svg|webp|ico).</p>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Repository description"
            className="mt-2"
          />
        </div>

        <div>
          <Label htmlFor="gitSshBase">SSH Base URL</Label>
          <Input
            id="gitSshBase"
            value={gitSshBase}
            onChange={(e) => setGitSshBase(e.target.value)}
            placeholder={process.env.NEXT_PUBLIC_GIT_SSH_BASE || "gittr.space"}
            className="mt-2"
          />
          <p className="text-xs text-gray-400 mt-1">
            SSH server hostname for Git operations. Used in clone URLs: <code className="bg-gray-800 px-1 rounded">git@{gitSshBase}:owner/repo.git</code>
          </p>
        </div>

        <div>
          <Label htmlFor="tags">Tags</Label>
          <div className="flex gap-2 mt-2">
            <Input
              id="tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
              placeholder="Add tag"
            />
            <Button onClick={handleAddTag}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {tags.map(tag => (
              <Badge key={tag} className="flex items-center gap-1">
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 hover:text-red-400"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <Label>
            <Zap className="inline h-4 w-4 mr-1" />
            Zap Split Policy
          </Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Configure how zaps to this repository are split among contributors.
            Total weights must sum to 100%.
          </p>
          
          <div className="space-y-2">
            {zapSplits.map((split, idx) => {
              const total = zapSplits.reduce((sum, s) => sum + s.weight, 0);
              return (
                <div key={idx} className="flex items-center gap-2 p-2 border border-gray-700 rounded">
                  <code className="text-sm flex-1">{split.pubkey.slice(0, 16)}...</code>
                  <span className="text-sm">{split.weight}%</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveSplit(split.pubkey)}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            
            <div className="flex gap-2 mt-2">
              <Input
                value={splitPubkey}
                onChange={(e) => setSplitPubkey(e.target.value)}
                placeholder="Contributor pubkey/npub"
                className="flex-1"
              />
              <Input
                type="number"
                min="1"
                max="100"
                value={splitWeight}
                onChange={(e) => setSplitWeight(e.target.value)}
                placeholder="Weight %"
                className="w-24"
              />
              <Button onClick={handleAddSplit}>Add</Button>
            </div>
            
            {zapSplits.length > 0 && (
              <p className="text-sm text-gray-400 mt-2">
                Total: {zapSplits.reduce((sum, s) => sum + s.weight, 0)}%
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>
            Repository Visibility
          </Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Control who can view this repository. Private repositories are only visible to owners and contributors.
          </p>
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant={isPublic ? "default" : "outline"}
              onClick={() => setIsPublic(true)}
              className={isPublic ? "bg-purple-600 hover:bg-purple-700" : ""}
            >
              <Globe className="h-4 w-4 mr-2" />
              Public
            </Button>
            <Button
              type="button"
              variant={!isPublic ? "default" : "outline"}
              onClick={() => setIsPublic(false)}
              className={!isPublic ? "bg-purple-600 hover:bg-purple-700" : ""}
            >
              <Lock className="h-4 w-4 mr-2" />
              Private
            </Button>
          </div>
        </div>

        <div>
          <Label>
            Required Approvals
          </Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Number of additional approvals required from owners/maintainers (excluding the person merging). Set to 0 to allow owners to merge their own changes without approvals. Only owners and maintainers can merge PRs; contributors can only approve.
          </p>
          <Input
            type="number"
            min="0"
            max="10"
            value={requiredApprovals}
            onChange={(e) => setRequiredApprovals(Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
            placeholder="1"
            className="w-32"
          />
        </div>

        {/* Owners Management */}
        <div>
          <Label>Repository Owners</Label>
          <p className="text-xs text-gray-400 mb-2">
            Owners can merge PRs, manage settings, and delete the repository. Contributors can only approve PRs.
          </p>
          <div className="space-y-2">
            {owners.map((owner) => {
              const meta = ownerMetadata[owner.pubkey];
              const displayName = meta?.display_name || meta?.name || owner.name || owner.pubkey.slice(0, 8) + "...";
              const isCurrentUser = owner.pubkey === pubkey;
              
              return (
                <div key={owner.pubkey} className="flex items-center justify-between p-2 border border-gray-700 rounded">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6 ring-2 ring-purple-500">
                      {meta?.picture && meta.picture.startsWith("http") ? (
                        <AvatarImage src={meta.picture} />
                      ) : null}
                      <AvatarFallback className="bg-gray-700 text-white text-xs">
                        {displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{displayName}</span>
                    {isCurrentUser && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                  </div>
                  {owners.length > 1 && !isCurrentUser && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveOwner(owner.pubkey)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <Input
              value={newOwnerInput}
              onChange={(e) => setNewOwnerInput(e.target.value)}
              placeholder="Enter npub or pubkey"
              className="flex-1"
              onKeyPress={(e) => e.key === "Enter" && handleAddOwner()}
            />
            <Button onClick={handleAddOwner} size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Add Owner
            </Button>
          </div>
        </div>

        {/* Maintainers Management */}
        <div>
          <Label>Maintainers</Label>
          <p className="text-xs text-gray-400 mb-2">
            Maintainers can merge PRs and approve PRs, but cannot manage all settings or delete the repository.
          </p>
          <div className="space-y-2">
            {maintainers.map((maintainer) => {
              const meta = ownerMetadata[maintainer.pubkey];
              const displayName = meta?.display_name || meta?.name || maintainer.name || maintainer.pubkey.slice(0, 8) + "...";
              const isCurrentUser = maintainer.pubkey === pubkey;
              
              return (
                <div key={maintainer.pubkey} className="flex items-center justify-between p-2 border border-gray-700 rounded">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6 ring-2 ring-blue-500">
                      {meta?.picture && meta.picture.startsWith("http") ? (
                        <AvatarImage src={meta.picture} />
                      ) : null}
                      <AvatarFallback className="bg-gray-700 text-white text-xs">
                        {displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{displayName}</span>
                    {isCurrentUser && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMaintainer(maintainer.pubkey)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <Input
              value={newMaintainerInput}
              onChange={(e) => setNewMaintainerInput(e.target.value)}
              placeholder="Enter npub or pubkey"
              className="flex-1"
              onKeyPress={(e) => e.key === "Enter" && handleAddMaintainer()}
            />
            <Button onClick={handleAddMaintainer} size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Add Maintainer
            </Button>
          </div>
          {/* Show contributors that can be added as maintainers */}
          {(() => {
            const repos = loadStoredRepos();
            const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
            const allContributors = repoData?.contributors || [];
            // Filter: contributors that are not already owners or maintainers, and have a pubkey
            const availableContributors = allContributors.filter((c: StoredContributor): c is StoredContributor & { pubkey: string } => 
              !!c.pubkey && 
              /^[0-9a-f]{64}$/i.test(c.pubkey) &&
              !owners.some(o => o.pubkey.toLowerCase() === c.pubkey!.toLowerCase()) &&
              !maintainers.some(m => m.pubkey.toLowerCase() === c.pubkey!.toLowerCase())
            );
            
            if (availableContributors.length > 0) {
              return (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <p className="text-xs text-gray-400 mb-2">Add from contributors:</p>
                  <div className="flex flex-wrap gap-2">
                    {availableContributors.slice(0, 5).map((contrib: any) => {
                      const meta = ownerMetadata[contrib.pubkey];
                      const displayName = meta?.display_name || meta?.name || contrib.name || contrib.pubkey.slice(0, 8) + "...";
                      return (
                        <Button
                          key={contrib.pubkey}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setNewMaintainerInput(contrib.pubkey);
                            handleAddMaintainer();
                          }}
                          className="text-xs"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          {displayName.length > 15 ? displayName.slice(0, 15) + "..." : displayName}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>

        <div>
          <Label>
            <Zap className="inline h-4 w-4 mr-1" />
            Payment Configuration
          </Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Configure wallet addresses for this repository (optional - defaults to user settings).
            Receiving: where zaps to the repo come in. Sending: for splits when repo receives zaps.
            Note: Bounties use YOUR wallet from Settings → Account, not the repo wallet.
          </p>
          
          <RepoWalletConfig entity={entity} repo={repo} onConfigChange={setRepoWalletConfig} />
        </div>

        {/* Distribute zaps UI */}
        <DistributeZaps entity={entity} repo={repo} contributors={(() => {
          const foundRepo = loadStoredRepos().find((r: StoredRepo) => r.entity === entity && r.repo === repo);
          return (foundRepo?.contributors || []).map((c: StoredContributor) => ({
            pubkey: c.pubkey,
            name: c.name,
            picture: c.picture,
            weight: c.weight ?? 0,
            githubLogin: c.githubLogin || c.login,
          }));
        })()} />

        {/* Repository Links */}
        <div>
          <Label>
            <LinkIcon className="inline h-4 w-4 mr-1" />
            Repository Links
          </Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Add links to documentation, social media, Discord, Slack, YouTube, Twitter, GitHub, or other resources. These will be displayed on the repository page below the contributors section.
          </p>
          
          <div className="space-y-2 mb-4">
            {repoLinks.map((link, idx) => {
              const Icon = link.type === "docs" ? BookOpen :
                          link.type === "discord" || link.type === "slack" ? MessageSquare :
                          link.type === "youtube" ? Youtube :
                          link.type === "twitter" ? Twitter :
                          link.type === "github" ? Github :
                          LinkIcon;
              
              const typeLabel = link.type === "docs" ? "Documentation" :
                               link.type === "discord" ? "Discord" :
                               link.type === "slack" ? "Slack" :
                               link.type === "youtube" ? "YouTube" :
                               link.type === "twitter" ? "Twitter" :
                               link.type === "github" ? "GitHub" :
                               "Link";
              
              return (
                <div key={idx} className="flex items-center justify-between p-2 border border-gray-700 rounded">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="text-sm text-gray-300 truncate">
                      {link.label || typeLabel}
                    </span>
                    <span className="text-xs text-gray-500 truncate hidden sm:inline">
                      ({link.url})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveLink(idx)}
                    className="h-6 w-6 p-0 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={newLinkType}
                onChange={(e) => setNewLinkType(e.target.value as RepoLink["type"])}
                className="px-3 py-2 bg-[#171B21] border border-gray-700 rounded text-white"
              >
                <option value="docs">Documentation</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="youtube">YouTube</option>
                <option value="twitter">Twitter</option>
                <option value="github">GitHub</option>
                <option value="other">Other</option>
              </select>
              <Input
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                onBlur={(e) => {
                  const normalized = normalizeUrlOnBlur(e.target.value);
                  if (normalized !== e.target.value) {
                    setNewLinkUrl(normalized);
                  }
                }}
                placeholder="https://example.com"
                className="flex-1"
                onKeyPress={(e) => e.key === "Enter" && handleAddLink()}
              />
            </div>
            <div className="flex gap-2">
              <Input
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="Custom label (optional)"
                className="flex-1"
                onKeyPress={(e) => e.key === "Enter" && handleAddLink()}
              />
              <Button onClick={handleAddLink} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add Link
              </Button>
            </div>
          </div>
        </div>

        <div>
          <Label>Milestones</Label>
          <p className="text-sm text-gray-400 mt-1 mb-3">
            Create milestones to track progress and organize issues.
          </p>
          
          <div className="space-y-3">
            {milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-start gap-2 p-3 border border-gray-700 rounded">
                <div className="flex-1">
                  <div className="font-medium text-purple-400">{milestone.name}</div>
                  {milestone.description && (
                    <div className="text-sm text-gray-400 mt-1">{milestone.description}</div>
                  )}
                  {milestone.dueDate && (
                    <div className="text-xs text-gray-500 mt-1">
                      Due: {formatDate24h(milestone.dueDate)}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMilestones(milestones.filter(m => m.id !== milestone.id));
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            
            <div className="border border-gray-700 rounded p-3 space-y-2">
              <Input
                value={milestoneName}
                onChange={(e) => setMilestoneName(e.target.value)}
                placeholder="Milestone name (e.g., v1.0)"
                className="w-full"
              />
              <Textarea
                value={milestoneDescription}
                onChange={(e) => setMilestoneDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full"
                rows={2}
              />
              <Input
                type="date"
                value={milestoneDueDate}
                onChange={(e) => setMilestoneDueDate(e.target.value)}
                placeholder="Due date (optional)"
                className="w-full"
              />
              <Button
                onClick={() => {
                  if (milestoneName.trim()) {
                    const newMilestone: Milestone = {
                      id: `milestone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      name: milestoneName.trim(),
                      description: milestoneDescription.trim() || undefined,
                      dueDate: milestoneDueDate ? new Date(milestoneDueDate).getTime() : undefined,
                    };
                    setMilestones([...milestones, newMilestone]);
                    setMilestoneName("");
                    setMilestoneDescription("");
                    setMilestoneDueDate("");
                  }
                }}
                disabled={!milestoneName.trim()}
                variant="outline"
              >
                Add Milestone
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="default"
          >
            {saving ? "Saving..." : "Save Settings"}
          </Button>
          <Button
            onClick={handleDeleteRepo}
            disabled={deleting || !pubkey}
            variant="outline"
            className="text-red-400 border-red-400 hover:bg-red-900/30"
            title={!pubkey ? "Please log in to delete repositories" : undefined}
          >
            {deleting ? "Deleting..." : "Delete Repository"}
          </Button>
          {status && (
            <span className={`text-sm ${
              status.includes("Error") ? "text-red-400" : "text-green-400"
            }`}>
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
