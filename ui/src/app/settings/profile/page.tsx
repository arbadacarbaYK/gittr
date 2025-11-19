"use client";

import { useEffect, useState, useRef } from "react";
import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import { getUserMetadata } from "@/lib/utils/entity-resolver";
import { ClaimedIdentity } from "@/lib/nostr/useContributorMetadata";
import { X, Plus, CheckCircle2, Copy, ChevronDown, ChevronUp } from "lucide-react";

import { type SubmitHandler, useForm } from "react-hook-form";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getEventHash, signEvent, nip19 } from "nostr-tools";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { publishWithConfirmation } from "@/lib/nostr/publish-with-confirmation";

type ProfileFormInputs = {
  displayName: string;
  userName: string;
  nip5: string;
  description: string;
  banner: string;
};

export default function ProfilePage() {
  const { publish, subscribe, defaultRelays, pubkey } = useNostrContext();
  // CRITICAL: Use centralized metadata cache instead of separate useMetadata hook
  // The hook returns the FULL cache, not just the pubkeys passed to it
  const metadataMap = useContributorMetadata(pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : []);
  // CRITICAL: Use centralized metadata lookup function for consistent behavior across all pages
  const metadata = getUserMetadata(pubkey, metadataMap);
  const { picture, name } = useSession();
  const [updating, setUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [identities, setIdentities] = useState<ClaimedIdentity[]>([]);
  const [newIdentityPlatform, setNewIdentityPlatform] = useState<string>("");
  const [newIdentityName, setNewIdentityName] = useState<string>("");
  const [newIdentityProof, setNewIdentityProof] = useState<string>("");

  // Use actual username, avoiding "Anonymous Nostrich" and shortened pubkeys
  // CRITICAL: Get picture from metadata if session doesn't have it
  const actualPicture = picture || metadata.picture || "";
  // CRITICAL: Never show shortened pubkey - prefer metadata name/display_name, or use npub
  const actualName = (() => {
    if (name && name !== "Anonymous Nostrich" && name.length > 8 && !/^[0-9a-f]{8,64}$/i.test(name)) {
      return name;
    }
    if (metadata.name && metadata.name.trim().length > 0 && metadata.name !== "Anonymous Nostrich") {
      return metadata.name;
    }
    if (metadata.display_name && metadata.display_name.trim().length > 0) {
      return metadata.display_name;
    }
    // Last resort: show npub (not shortened pubkey)
    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
      try {
        return nip19.npubEncode(pubkey).substring(0, 16) + "...";
      } catch {}
    }
    return "";
  })();

  // CRITICAL: Get the actual username from metadata (not the fallback npub)
  const actualUserName = (() => {
    // Priority 1: Use metadata.name if it's a real username (not npub or pubkey)
    if (metadata.name && metadata.name.trim().length > 0 && 
        metadata.name !== "Anonymous Nostrich" && 
        !metadata.name.startsWith("npub") && 
        !/^[0-9a-f]{8,64}$/i.test(metadata.name)) {
      return metadata.name;
    }
    // Priority 2: Use session name if it's valid
    if (name && name !== "Anonymous Nostrich" && 
        name.length > 8 && 
        !/^[0-9a-f]{8,64}$/i.test(name)) {
      return name;
    }
    // Priority 3: Use metadata.display_name
    if (metadata.display_name && metadata.display_name.trim().length > 0) {
      return metadata.display_name;
    }
    return "";
  })();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ProfileFormInputs>({
    defaultValues: {
      displayName: "",
      userName: "",
      nip5: "",
      description: "",
      banner: "",
    },
  });

  // Watch form values to debug
  const formValues = watch();
  
  // Load existing identities from metadata
  // NIP-39 is just Kind 0 events with i tags - any relay supporting Kind 0 supports NIP-39
  // localStorage fallback is ONLY for propagation delays (relays might not have the event yet)
  useEffect(() => {
      if (metadata.identities && Array.isArray(metadata.identities) && metadata.identities.length > 0) {
        console.log("✅ [Profile Settings] Loading identities from Nostr metadata (NIP-39):", metadata.identities);
        setIdentities(metadata.identities);
        // Update backup when we get fresh metadata from Nostr (Nostr now has it, so backup is confirmed)
        localStorage.setItem('gittr_profile_identities_backup', JSON.stringify(metadata.identities));
        localStorage.setItem('gittr_profile_identities_backup_time', Date.now().toString());
        localStorage.setItem('gittr_profile_identities_backup_confirmed', 'true'); // Nostr has it, so confirmed
    } else {
      // Fallback: Use localStorage backup if available (persists until we get confirmation from Nostr)
      // This handles propagation delays and server restarts
      // We keep the backup until we successfully fetch identities from Nostr metadata
      try {
        const backupTime = localStorage.getItem('gittr_profile_identities_backup_time');
        const backup = localStorage.getItem('gittr_profile_identities_backup');
        const backupConfirmed = localStorage.getItem('gittr_profile_identities_backup_confirmed') === 'true';
        
        if (backup && backupTime) {
          const backupIdentities = JSON.parse(backup);
          if (Array.isArray(backupIdentities) && backupIdentities.length > 0) {
            const timeSinceBackup = Date.now() - parseInt(backupTime, 10);
            const hoursSinceBackup = timeSinceBackup / (60 * 60 * 1000);
            
            // Use backup if:
            // 1. It was confirmed by relays (keep it indefinitely until Nostr has it)
            // 2. OR it's less than 24 hours old (propagation delay)
            if (backupConfirmed || hoursSinceBackup < 24) {
              console.log(`⚠️ [Profile Settings] Using localStorage backup (${backupConfirmed ? 'confirmed' : 'unconfirmed'}, ${Math.round(hoursSinceBackup * 10) / 10}h ago - ${backupIdentities.length} identities)`);
              setIdentities(backupIdentities);
            } else {
              console.warn(`⚠️ [Profile Settings] Backup is ${Math.round(hoursSinceBackup)} hours old and unconfirmed - clearing. Check relay connectivity.`);
              // Only clear if it's old AND unconfirmed
              localStorage.removeItem('gittr_profile_identities_backup');
              localStorage.removeItem('gittr_profile_identities_backup_time');
              localStorage.removeItem('gittr_profile_identities_backup_confirmed');
            }
          }
        }
      } catch (e) {
        console.error("Failed to load identities backup:", e);
      }
    }
  }, [metadata.identities]);
  
  // Load GitHub connection from account settings and sync with NIP-39 identities
  useEffect(() => {
    if (!pubkey) return;
    
    // Check if user has connected GitHub on account page
    const githubProfile = localStorage.getItem("gittr_github_profile");
    if (githubProfile) {
      try {
        // Extract username from GitHub URL
        const url = new URL(githubProfile);
        const pathParts = url.pathname.split("/").filter(p => p);
        const githubUsername = pathParts[0];
        
        if (githubUsername) {
          // Check if this GitHub identity is already in the identities list
          setIdentities(prev => {
            const hasGithubIdentity = prev.some(id => 
              id.platform === "github" && id.identity === githubUsername
            );
            
            // If not in list, add it (but don't overwrite existing ones)
            if (!hasGithubIdentity) {
              return [...prev, {
                platform: "github",
                identity: githubUsername,
                proof: undefined, // User can add proof later
                verified: false,
              }];
            }
            return prev;
          });
        }
      } catch (e) {
        console.error("Failed to parse GitHub profile URL:", e);
      }
    }
  }, [pubkey]); // Run when pubkey changes or component mounts
  
  // Listen for GitHub connection events from account page
  useEffect(() => {
    const handleGithubConnected = (event: CustomEvent) => {
      const { username } = event.detail;
      if (username) {
        setIdentities(prev => {
          // Check if already in identities
          const hasGithubIdentity = prev.some(id => 
            id.platform === "github" && id.identity === username
          );
          
          if (!hasGithubIdentity) {
            return [...prev, {
              platform: "github",
              identity: username,
              proof: undefined,
              verified: false,
            }];
          }
          return prev;
        });
      }
    };
    
    window.addEventListener('gittr:github-connected', handleGithubConnected as EventListener);
    return () => {
      window.removeEventListener('gittr:github-connected', handleGithubConnected as EventListener);
    };
  }, []);

  // Update form when metadata loads - use a ref to track if metadata has been processed
  const metadataProcessedRef = useRef<string>("");
  useEffect(() => {
    // Debug: Log metadata state
    console.log("🔍 [Profile Settings] Metadata check:", {
      hasMetadata: !!metadata && Object.keys(metadata).length > 0,
      metadataKeys: Object.keys(metadata),
      display_name: metadata.display_name,
      name: metadata.name,
      nip05: metadata.nip05,
      about: metadata.about ? metadata.about.substring(0, 30) + "..." : "",
      pubkey: pubkey ? pubkey.slice(0, 8) : "none"
    });
    
    // Recompute actualUserName for the reset
    const newActualUserName = (() => {
      if (metadata.name && metadata.name.trim().length > 0 && 
          metadata.name !== "Anonymous Nostrich" && 
          !metadata.name.startsWith("npub") && 
          !/^[0-9a-f]{8,64}$/i.test(metadata.name)) {
        return metadata.name;
      }
      if (name && name !== "Anonymous Nostrich" && 
          name.length > 8 && 
          !/^[0-9a-f]{8,64}$/i.test(name)) {
        return name;
      }
      if (metadata.display_name && metadata.display_name.trim().length > 0) {
        return metadata.display_name;
      }
      return "";
    })();
    
    // Create a key from metadata to detect actual changes
    const metadataKey = JSON.stringify({
      display_name: metadata.display_name || "",
      name: metadata.name || "",
      nip05: metadata.nip05 || "",
      about: metadata.about || "",
      userName: newActualUserName || "",
    });
    
    // Always update form if metadata exists and hasn't been processed yet
    // This ensures form fields are populated even if metadata loads after initial render
    if (metadataKey !== metadataProcessedRef.current) {
      const formData = {
      displayName: metadata.display_name || "",
        userName: newActualUserName || "",
      nip5: metadata.nip05 || "",
      description: metadata.about || "",
      banner: metadata.banner || "",
      };
      
      reset(formData);
      metadataProcessedRef.current = metadataKey;
      console.log("✅ [Profile Settings] Updated form with metadata:", { 
        display_name: metadata.display_name, 
        name: metadata.name, 
        userName: newActualUserName,
        nip05: metadata.nip05,
        about: metadata.about ? metadata.about.substring(0, 50) + "..." : "",
        formData
      });
    } else if (metadataKey && (metadata.display_name || metadata.name || metadata.nip05 || metadata.about)) {
      // If metadata exists but form might not be populated, ensure it's set
      const currentFormData = {
        displayName: formValues.displayName || "",
        userName: formValues.userName || "",
        nip5: formValues.nip5 || "",
        description: formValues.description || "",
        banner: formValues.banner || "",
      };
      
      const expectedFormData = {
        displayName: metadata.display_name || "",
        userName: newActualUserName || "",
        nip5: metadata.nip05 || "",
        description: metadata.about || "",
        banner: metadata.banner || "",
      };
      
      // Only reset if form is empty but metadata exists
      if (!currentFormData.displayName && !currentFormData.userName && !currentFormData.nip5 && !currentFormData.description) {
        if (expectedFormData.displayName || expectedFormData.userName || expectedFormData.nip5 || expectedFormData.description) {
          reset(expectedFormData);
          console.log("✅ [Profile Settings] Form was empty, populated with metadata:", expectedFormData);
        }
      }
    }
  }, [metadata, name, reset, formValues, pubkey]);

  const onSubmit: SubmitHandler<ProfileFormInputs> = async (data) => {
    console.log("🔄 [Profile Settings] onSubmit called", { hasPubkey: !!pubkey, hasPublish: !!publish, hasSubscribe: !!subscribe });
    
    if (!pubkey) {
      setUpdateStatus("❌ Please log in to update your profile");
      return;
    }

    // Check for NIP-07 first (preferred method - like repo pushing)
    const hasNip07 = typeof window !== "undefined" && window.nostr;
    let privateKey: string | null = null;
    
    if (!hasNip07) {
      // Fallback to stored private key only if NIP-07 not available
      privateKey = await getNostrPrivateKey();
      if (!privateKey) {
        setUpdateStatus("❌ No signing method available. Please use a NIP-07 extension (like Alby or nos2x) or configure a private key in Settings.");
        return;
      }
    }

    setUpdating(true);
    setUpdateStatus("Preparing profile update...");

    try {
      // Create kind 0 metadata event
      // CRITICAL: Only include fields that have actual values (not empty strings)
      // Empty strings will be converted to undefined and removed, preventing overwriting of existing relay metadata
      const metadata: Record<string, any> = {};
      
      if (data.displayName && data.displayName.trim()) {
        metadata.display_name = data.displayName.trim();
      }
      if (data.userName && data.userName.trim()) {
        metadata.name = data.userName.trim();
      }
      if (data.description && data.description.trim()) {
        metadata.about = data.description.trim();
      }
      if (data.nip5 && data.nip5.trim()) {
        metadata.nip05 = data.nip5.trim();
      }
      if (actualPicture && actualPicture.trim()) {
        metadata.picture = actualPicture.trim();
      }
      // CRITICAL: Only include banner if it has a value - empty string means "don't set banner"
      // This prevents overwriting existing banner from relays with an empty value
      if (data.banner && data.banner.trim()) {
        metadata.banner = data.banner.trim();
      }

      // Build NIP-39 i tags for claimed identities
      const iTags: string[][] = [];
      identities.forEach((identity) => {
        if (identity.platform && identity.identity) {
          const identityString = `${identity.platform}:${identity.identity}`;
          if (identity.proof) {
            iTags.push(["i", identityString, identity.proof]);
          } else {
            iTags.push(["i", identityString]);
          }
        }
      });
      
      let event: any = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: iTags, // Include NIP-39 identity tags
        content: JSON.stringify(metadata),
        pubkey: pubkey,
        id: "",
        sig: "",
      };

      // Hash the event first
      event.id = getEventHash(event);
      
      // Sign with NIP-07 or private key
      if (hasNip07 && window.nostr) {
        // Use NIP-07 extension - this will trigger a popup for the user to sign
        console.log("🔐 [Profile Settings] Using NIP-07 to sign event...");
        setUpdateStatus("Waiting for NIP-07 extension to sign...");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        event = await window.nostr.signEvent(event as any);
        console.log("✅ [Profile Settings] Event signed with NIP-07");
      } else if (privateKey) {
        // Use private key (fallback)
        event.sig = signEvent(event, privateKey);
        console.log("🔐 [Profile Settings] Event signed with private key");
      } else {
        throw new Error("No signing method available");
      }

      // Publish to relays with confirmation
      if (publish && subscribe) {
        setUpdateStatus("Publishing profile update to relays...");
        
        try {
          // Store identities in localStorage as backup (persists until we get confirmation from Nostr)
          // NIP-39 works on all Kind 0-supporting relays - this backup handles propagation delays and server restarts
          localStorage.setItem('gittr_profile_identities_backup', JSON.stringify(identities));
          localStorage.setItem('gittr_profile_identities_backup_time', Date.now().toString());
          localStorage.setItem('gittr_profile_identities_backup_confirmed', 'false'); // Will be set to true if confirmed
          
          // Log the event being published for debugging
          console.log("📤 [Profile Settings] Publishing event with identities:", {
            eventId: event.id.substring(0, 16) + '...',
            fullEventId: event.id,
            iTags: event.tags.filter((t: any) => Array.isArray(t) && t[0] === 'i'),
            identitiesCount: identities.length,
            allTags: event.tags,
            pubkey: pubkey?.substring(0, 16) + '...',
            relaysCount: defaultRelays?.length || 0,
            relays: defaultRelays
          });
          
          // Publish with confirmation (like we do for repos)
          console.log("📡 [Profile Settings] Calling publishWithConfirmation...");
          const result = await publishWithConfirmation(
            publish,
            subscribe,
            event,
            defaultRelays || [],
            10000 // 10 second timeout
          );
          
          console.log("📬 [Profile Settings] publishWithConfirmation result:", {
            eventId: result.eventId,
            confirmed: result.confirmed,
            confirmedRelays: result.confirmedRelays,
            confirmedRelaysCount: result.confirmedRelays.length
          });
          
          // Store event locally as backup
          localStorage.setItem(`gittr_profile_update_${Date.now()}`, JSON.stringify(event));
          
          // CRITICAL: Immediately update the metadata cache with the new values
          // This ensures the banner (and other fields) appear immediately on the profile page
          // even before relays fully propagate the update
          if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
            try {
              const normalizedPubkey = pubkey.toLowerCase();
              const cacheKey = 'gittr_metadata_cache';
              const existingCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
              
              // Parse the event content to get the metadata
              const eventMetadata = JSON.parse(event.content);
              
              // Parse identities from i tags
              const eventIdentities: ClaimedIdentity[] = [];
              if (event.tags && Array.isArray(event.tags)) {
                for (const tag of event.tags) {
                  if (Array.isArray(tag) && tag.length >= 2 && tag[0] === "i") {
                    const identityString = tag[1];
                    const proof = tag[2] || undefined;
                    
                    if (identityString && typeof identityString === "string") {
                      const parts = identityString.split(":");
                      if (parts.length >= 2 && parts[0]) {
                        const platform = parts[0];
                        const identity = parts.slice(1).join(":");
                        if (platform && identity) {
                          eventIdentities.push({
                            platform,
                            identity,
                            proof,
                            verified: false,
                          });
                        }
                      }
                    }
                  }
                }
              }
              
              // Update cache with new metadata (merge with existing to preserve other fields)
              existingCache[normalizedPubkey] = {
                ...existingCache[normalizedPubkey],
                ...eventMetadata,
                identities: eventIdentities, // CRITICAL: Include identities from i tags
                created_at: event.created_at, // Update timestamp
              };
              
              localStorage.setItem(cacheKey, JSON.stringify(existingCache));
              console.log(`✅ [Profile Settings] Updated metadata cache immediately with ${eventIdentities.length} identities:`, eventIdentities.map(i => `${i.platform}:${i.identity}`));
              
              // CRITICAL: Dispatch custom event to notify other components (same-tab updates)
              // Storage events only fire from OTHER tabs, so we need a custom event for same-tab updates
              window.dispatchEvent(new CustomEvent('gittr:metadata-cache-updated', {
                detail: {
                  pubkey: normalizedPubkey,
                  metadata: {
                    ...eventMetadata,
                    identities: eventIdentities // Include identities in the event
                  }
                }
              }));
              console.log(`📢 [Profile Settings] Dispatched metadata cache update event for ${normalizedPubkey.slice(0, 8)}`);
            } catch (e) {
              console.warn("⚠️ [Profile Settings] Failed to update metadata cache immediately:", e);
            }
          }
          
          if (result.confirmed) {
            // Mark backup as confirmed - keep it until Nostr metadata has it
            localStorage.setItem('gittr_profile_identities_backup_confirmed', 'true');
            setUpdateStatus(`✅ Profile update published and confirmed! Event ID: ${result.eventId.substring(0, 16)}... Confirmed by ${result.confirmedRelays.length} relay(s). Reloading in 3 seconds...`);
            console.log("✅ [Profile Settings] Event confirmed by relays:", result.confirmedRelays);
          } else {
            // Keep backup but mark as unconfirmed - will expire after 24 hours
            localStorage.setItem('gittr_profile_identities_backup_confirmed', 'false');
            setUpdateStatus(`⚠️ Profile update published but awaiting confirmation. Event ID: ${result.eventId.substring(0, 16)}... Reloading in 3 seconds...`);
            console.warn("⚠️ [Profile Settings] Event published but not confirmed yet. This might be due to relay connectivity issues.");
          }
          
          setUpdating(false);
          
          // Wait for relays to propagate, then refresh metadata
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        } catch (error: any) {
          console.error("❌ [Profile Settings] Failed to publish:", error);
          console.error("❌ [Profile Settings] Error details:", {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
          setUpdateStatus(`❌ Error publishing: ${error.message || "Failed to publish"}`);
          setUpdating(false);
        }
      } else {
        console.error("❌ [Profile Settings] Missing publish or subscribe:", { hasPublish: !!publish, hasSubscribe: !!subscribe });
        throw new Error("Publish or subscribe function not available");
      }
    } catch (error: any) {
      console.error("❌ [Profile Settings] onSubmit error:", error);
      setUpdateStatus(`❌ Error: ${error.message || "Failed to update profile"}`);
      setUpdating(false);
    }
  };

  return (
    <>
      <SettingsHero title="Profile" />
      <div className="lg:flex lg:space-x-8">
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1">
          <div className="space-y-4 max-w-2xl w-full mb-4">
            <div className="space-y-1">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                type="text"
                id="display-name"
                placeholder="John Doe"
                {...register("displayName")}
              />
              <p className="text-sm text-zinc-500">
                Your display will be shown on all Nostr clients, and on
                NostrGit.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input
                type="text"
                id="username"
                placeholder="Your Nostr username"
                {...register("userName")}
              />
              <p className="text-sm text-zinc-500">
                Your Nostr username (from your profile metadata)
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nip5">NIP-5</Label>
              <Input
                type="text"
                id="nip5"
                placeholder="satoshi@nakamoto.com"
                {...register("nip5")}
              />
              <p className="text-sm text-zinc-500">
                To learn more about NIP5 and how to get verified, visit{" "}
                <a
                  className="text-purple-500 underline"
                  href="https://nostr.how/verify-your-identity"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  nostr.how
                </a>
                .
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Textarea
                rows={5}
                id="description"
                placeholder="nostrgit maintainer. bitcoiner. pura vida"
                {...register("description")}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="banner">Banner Image URL</Label>
              <Input
                id="banner"
                type="url"
                {...register("banner")}
                placeholder="https://example.com/banner.jpg"
              />
              <p className="text-xs text-gray-500 mt-1">
                URL for your profile banner image (displayed at the top of your profile page)
              </p>
            </div>
            
            {/* Claimed Identities (NIP-39) */}
            <div className="space-y-3 border-t border-[#383B42] pt-4">
              <Label className="text-base font-semibold">Verified Identities (NIP-39)</Label>
              <p className="text-sm text-zinc-500">
                Claim your external identities (GitHub, X, etc.) to verify ownership.
                <br />
                <span className="text-purple-400">💡 Tip:</span> If you connected GitHub on the{" "}
                <a href="/settings/account" className="text-purple-400 hover:text-purple-300 underline">
                  Account page
                </a>
                , it will appear here automatically.
              </p>
              
              {/* Existing Identities */}
              {identities.length > 0 && (
                <div className="space-y-2">
                  {identities.map((identity, idx) => {
                    const platformDisplayName = identity.platform === "twitter" 
                      ? "X" 
                      : identity.platform === "telegram"
                      ? "Telegram"
                      : identity.platform === "mastodon"
                      ? "Mastodon"
                      : identity.platform.charAt(0).toUpperCase() + identity.platform.slice(1);
                    const identityDisplay = identity.platform === "telegram" 
                      ? identity.identity 
                      : identity.platform === "mastodon"
                      ? identity.identity
                      : `@${identity.identity}`;
                    
                    return (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-[#22262C] border border-[#383B42] rounded">
                        <span className="text-sm text-gray-300">{platformDisplayName}</span>
                        <span className="text-sm text-purple-400">{identityDisplay}</span>
                        {identity.proof && (
                          <span className="text-xs text-gray-500">Proof: {identity.proof}</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 w-6 p-0"
                          onClick={() => {
                            setIdentities(identities.filter((_, i) => i !== idx));
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              
              {/* Add New Identity */}
              <div className="space-y-2 p-3 bg-[#22262C] border border-[#383B42] rounded">
                <div className="flex gap-2">
                  <select
                    value={newIdentityPlatform}
                    onChange={(e) => setNewIdentityPlatform(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[#171B21] border border-[#383B42] rounded text-sm text-gray-300"
                  >
                    <option value="">Select platform...</option>
                    <option value="github">GitHub</option>
                    <option value="twitter">X</option>
                    <option value="telegram">Telegram</option>
                    <option value="mastodon">Mastodon</option>
                    <option value="other">Other</option>
                  </select>
                  <Input
                    type="text"
                    placeholder={newIdentityPlatform === "telegram" ? "User ID (e.g., 1087295469)" : newIdentityPlatform === "mastodon" ? "instance/@username" : "username"}
                    value={newIdentityName}
                    onChange={(e) => setNewIdentityName(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <Input
                  type="text"
                  placeholder={
                    newIdentityPlatform === "github" 
                      ? "Proof (GitHub Gist ID)" 
                      : newIdentityPlatform === "twitter" 
                      ? "Proof (Tweet ID from x.com/username/status/1234567890)" 
                      : newIdentityPlatform === "telegram"
                      ? "Proof (channel/message_id, e.g., nostrdirectory/770)"
                      : newIdentityPlatform === "mastodon"
                      ? "Proof (Post ID)"
                      : "Proof (optional)"
                  }
                  value={newIdentityProof}
                  onChange={(e) => setNewIdentityProof(e.target.value)}
                  className="text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (newIdentityPlatform && newIdentityName) {
                      // Normalize identity for Telegram (should be user ID, not username)
                      let normalizedIdentity = newIdentityName.trim();
                      let normalizedProof = newIdentityProof.trim() || undefined;
                      
                      // For Telegram, ensure we're using user ID (numeric)
                      if (newIdentityPlatform === "telegram") {
                        // Remove @ if user added it
                        normalizedIdentity = normalizedIdentity.replace(/^@/, "");
                        // Ensure it's numeric (user ID)
                        if (!/^\d+$/.test(normalizedIdentity)) {
                          alert("Telegram identity must be a numeric User ID (e.g., 1087295469). Get it from @userinfobot on Telegram.");
                          return;
                        }
                      }
                      
                      // For Mastodon, normalize format
                      if (newIdentityPlatform === "mastodon") {
                        // Should be in format: instance/@username or instance/username
                        if (!normalizedIdentity.includes("/")) {
                          alert("Mastodon identity must be in format: instance/@username (e.g., bitcoinhackers.org/@semisol)");
                          return;
                        }
                      }
                      
                      const newIdentity = {
                        platform: newIdentityPlatform,
                        identity: normalizedIdentity,
                        proof: normalizedProof,
                        verified: false,
                      };
                      
                      // Check for duplicates
                      const isDuplicate = identities.some(
                        id => id.platform === newIdentity.platform && id.identity === newIdentity.identity
                      );
                      
                      if (isDuplicate) {
                        alert(`This ${newIdentityPlatform} identity is already added.`);
                        return;
                      }
                      
                      const updatedIdentities = [...identities, newIdentity];
                      setIdentities(updatedIdentities);
                      
                      // Save to backup immediately (before publishing)
                      localStorage.setItem('gittr_profile_identities_backup', JSON.stringify(updatedIdentities));
                      localStorage.setItem('gittr_profile_identities_backup_time', Date.now().toString());
                      localStorage.setItem('gittr_profile_identities_backup_confirmed', 'false'); // Will be confirmed after successful publish
                      
                      console.log("✅ [Profile Settings] Added identity:", newIdentity);
                      console.log("✅ [Profile Settings] Total identities:", updatedIdentities.length);
                      
                      setNewIdentityName("");
                      setNewIdentityProof("");
                    }
                  }}
                  disabled={!newIdentityPlatform || !newIdentityName}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Identity
                </Button>
              </div>

              {/* Collapsible Help Sections - shown when platform is selected */}
              <div className="text-xs text-gray-400 space-y-2 mt-2">
                {/* GitHub Help */}
                <div className={`border border-[#383B42] rounded overflow-hidden transition-all ${newIdentityPlatform === "github" ? "bg-[#171B21]" : "bg-[#0f172a]"}`}>
                  <button
                    type="button"
                    onClick={() => setNewIdentityPlatform(newIdentityPlatform === "github" ? "" : "github")}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-[#22262C] transition-colors"
                  >
                    <strong className="text-gray-300">GitHub</strong>
                    {newIdentityPlatform === "github" ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {newIdentityPlatform === "github" && (
                    <div className="p-2 border-t border-[#383B42]">
                      <p className="mb-2">Create a public Gist with:</p>
                      <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
                        <li><strong>Content:</strong> <code className="bg-[#22262C] px-1 rounded">Verifying that I control the following Nostr public key: "npub1abc123..."</code></li>
                      </ul>
                      <p className="mt-2">Then use the Gist ID (from the URL: <code className="bg-[#22262C] px-1 rounded">gist.github.com/username/1234567890abcdef</code>) as proof.</p>
                    </div>
                  )}
                </div>

                {/* X/Twitter Help */}
                <div className={`border border-[#383B42] rounded overflow-hidden transition-all ${newIdentityPlatform === "twitter" ? "bg-[#171B21]" : "bg-[#0f172a]"}`}>
                  <button
                    type="button"
                    onClick={() => setNewIdentityPlatform(newIdentityPlatform === "twitter" ? "" : "twitter")}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-[#22262C] transition-colors"
                  >
                    <strong className="text-gray-300">X (formerly Twitter)</strong>
                    {newIdentityPlatform === "twitter" ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {newIdentityPlatform === "twitter" && (
                    <div className="p-2 border-t border-[#383B42] space-y-3">
                      <div>
                        <p className="mb-2 font-semibold">Option 1: Post a tweet</p>
                        <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
                          <li><strong>Content:</strong> <code className="bg-[#22262C] px-1 rounded">Verifying my account on nostr My Public Key: "npub1abc123..."</code></li>
                          <li>Use the Tweet ID (from URL: <code className="bg-[#22262C] px-1 rounded">x.com/username/status/1234567890</code>) as proof</li>
                        </ul>
                      </div>
                      <div className="border-t border-[#383B42] pt-2">
                        <p className="mb-2 font-semibold">Option 2: Add to bio</p>
                        <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
                          <li>Add your npub to your X profile bio</li>
                          <li>Use your username as proof (no Tweet ID needed)</li>
                          <li>Example proof: <code className="bg-[#22262C] px-1 rounded">your_username</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                {/* Telegram Help */}
                <div className={`border border-[#383B42] rounded overflow-hidden transition-all ${newIdentityPlatform === "telegram" ? "bg-[#171B21]" : "bg-[#0f172a]"}`}>
                  <button
                    type="button"
                    onClick={() => setNewIdentityPlatform(newIdentityPlatform === "telegram" ? "" : "telegram")}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-[#22262C] transition-colors"
                  >
                    <strong className="text-gray-300">Telegram</strong>
                    {newIdentityPlatform === "telegram" ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {newIdentityPlatform === "telegram" && (
                    <div className="p-2 border-t border-[#383B42]">
                      <p className="mb-2">Post in a public channel/group:</p>
                      <ol className="list-decimal list-inside ml-2 mt-1 space-y-2">
                    <li><strong>Post verification message:</strong> In the <a href="https://t.me/gittrspace" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@gittrspace</a> channel, post:
                          <div className="mt-1 p-2 bg-[#22262C] border border-[#383B42] rounded flex items-center gap-2 group">
                            <code className="flex-1 text-xs select-all" id="telegram-verification-text">Verifying that I control the following Nostr public key: "npub1abc123..."</code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={async (e) => {
                                const text = document.getElementById("telegram-verification-text")?.textContent || "";
                                try {
                                  await navigator.clipboard.writeText(text);
                                  const btn = e.currentTarget as HTMLButtonElement;
                                  if (btn) {
                                    const originalHTML = btn.innerHTML;
                                    btn.innerHTML = "✓";
                                    btn.className = "h-6 w-6 p-0 text-green-400";
                                    setTimeout(() => {
                                      btn.innerHTML = originalHTML;
                                      btn.className = "h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity";
                                    }, 2000);
                                  }
                                } catch (err) {
                                  console.error("Failed to copy:", err);
                                }
                              }}
                              title="Copy to clipboard"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                    <li><strong>Get your info:</strong> The bot will reply to your message in the channel with your message ID. Then start a conversation with <a href="https://t.me/ngitspacebot" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@ngitspacebot</a> (send <code className="bg-[#22262C] px-1 rounded">/start</code>) to get your User ID.</li>
                    <li><strong>Add to gittr.space:</strong> Use the values from the bot:
                          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                            <li>Platform: <code className="bg-[#22262C] px-1 rounded">telegram</code></li>
                            <li>User ID: <code className="bg-[#22262C] px-1 rounded">from bot's DM</code></li>
                            <li>Proof: <code className="bg-[#22262C] px-1 rounded">gittrspace/message_id</code> (from bot's DM)</li>
                          </ul>
                        </li>
                      </ol>
                      <div className="text-xs text-gray-500 mt-2 p-2 bg-[#171B21] border border-[#383B42] rounded">
                        <p className="font-semibold text-gray-400 mb-1">💡 Alternative ways to get your User ID (if needed):</p>
                        <ul className="list-disc list-inside ml-2 space-y-1">
                          <li>Message <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@userinfobot</a> or <a href="https://t.me/MissRose_bot" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@MissRose_bot</a> on Telegram</li>
                          <li>Telegram Desktop: Settings → Advanced → Experimental → Enable "Show Peer ID" (then view your profile)</li>
                          <li>Telegram Web: Your User ID is in the URL when viewing your profile (e.g., <code className="bg-[#22262C] px-1 rounded">web.telegram.org/k/#-123456789</code>)</li>
                        </ul>
                        <p className="mt-2 text-gray-400">Note: The bot will send you your User ID automatically, so you usually don't need these alternatives!</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mastodon Help */}
                <div className={`border border-[#383B42] rounded overflow-hidden transition-all ${newIdentityPlatform === "mastodon" ? "bg-[#171B21]" : "bg-[#0f172a]"}`}>
                  <button
                    type="button"
                    onClick={() => setNewIdentityPlatform(newIdentityPlatform === "mastodon" ? "" : "mastodon")}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-[#22262C] transition-colors"
                  >
                    <strong className="text-gray-300">Mastodon</strong>
                    {newIdentityPlatform === "mastodon" ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {newIdentityPlatform === "mastodon" && (
                    <div className="p-2 border-t border-[#383B42]">
                      <p className="mb-2">Post on your instance:</p>
                      <ol className="list-decimal list-inside ml-2 mt-1 space-y-2">
                        <li><strong>Post content:</strong> On your Mastodon instance, post:
                          <div className="mt-1 p-2 bg-[#22262C] border border-[#383B42] rounded flex items-center gap-2 group">
                            <code className="flex-1 text-xs select-all" id="mastodon-verification-text">Verifying that I control the following Nostr public key: "npub1abc123..."</code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={async (e) => {
                                const text = document.getElementById("mastodon-verification-text")?.textContent || "";
                                try {
                                  await navigator.clipboard.writeText(text);
                                  const btn = e.currentTarget as HTMLButtonElement;
                                  if (btn) {
                                    const originalHTML = btn.innerHTML;
                                    btn.innerHTML = "✓";
                                    btn.className = "h-6 w-6 p-0 text-green-400";
                                    setTimeout(() => {
                                      btn.innerHTML = originalHTML;
                                      btn.className = "h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity";
                                    }, 2000);
                                  }
                                } catch (err) {
                                  console.error("Failed to copy:", err);
                                }
                              }}
                              title="Copy to clipboard"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                        <li><strong>Get Post ID:</strong> After posting, look at the URL of your post. It will look like:
                          <code className="block mt-1 bg-[#22262C] px-2 py-1 rounded text-xs">https://your-instance.com/@username/123456789012345678</code>
                          The number at the end (<code className="bg-[#22262C] px-1 rounded">123456789012345678</code>) is your Post ID.
                        </li>
                        <li><strong>Add to gittr:</strong>
                          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                            <li>Platform: <code className="bg-[#22262C] px-1 rounded">mastodon</code></li>
                            <li>Identity: <code className="bg-[#22262C] px-1 rounded">your-instance.com/@username</code> (from your profile URL)</li>
                            <li>Proof: <code className="bg-[#22262C] px-1 rounded">your-instance.com/@username/post_id</code> (instance/@username/post_id format)</li>
                          </ul>
                        </li>
                      </ol>
                      <div className="text-xs text-gray-500 mt-2 p-2 bg-[#171B21] border border-[#383B42] rounded">
                        <p className="font-semibold text-gray-400 mb-1">💡 Tip:</p>
                        <p>You can also find the Post ID by clicking the timestamp on your post - it will show the direct link with the ID in the URL.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              type="submit"
              className=""
              disabled={Object.keys(errors).length > 0 || updating}
            >
              {updating ? "Publishing..." : "Update profile"}
            </Button>
            {updateStatus && (
              <div className={`mt-2 p-3 rounded text-sm ${
                updateStatus.startsWith("✅") 
                  ? "bg-green-900/30 border border-green-700 text-green-300"
                  : updateStatus.startsWith("⚠️")
                  ? "bg-yellow-900/30 border border-yellow-700 text-yellow-300"
                  : updateStatus.startsWith("Error") || updateStatus.includes("Error")
                  ? "bg-red-900/30 border border-red-700 text-red-300"
                  : "bg-blue-900/30 border border-blue-700 text-blue-300"
              }`}>
                {updateStatus}
              </div>
            )}
          </div>
        </form>
        <div className="space-y-6 lg:min-w-[300px]">
          <div>
            <Label htmlFor="profile-picture">Profile Picture</Label>
            {/* eslint-disable-next-line @next/next/no-img-element*/}
            <img
              src={actualPicture || "/default-avatar.png"}
              alt={actualName || "Profile"}
              className="my-4 rounded-full w-52 h-52 max-w-52 max-h-52 object-cover"
              style={{ maxWidth: '13rem', maxHeight: '13rem' }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/default-avatar.png";
              }}
            />
          </div>
          
          {/* Nostr Credentials */}
          <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
            <Label className="text-base font-semibold mb-3 block">Nostr Credentials</Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">Public Key (hex)</Label>
                <div className="bg-gray-900 p-2 rounded border border-gray-700">
                  <code className="text-xs text-gray-300 font-mono break-all">
                    {pubkey || "Not available"}
                  </code>
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">NPUB (bech32)</Label>
                <div className="bg-gray-900 p-2 rounded border border-gray-700">
                  <code className="text-xs text-gray-300 font-mono break-all">
                    {pubkey ? (() => {
                      try {
                        return nip19.npubEncode(pubkey);
                      } catch {
                        return "Invalid pubkey";
                      }
                    })() : "Not available"}
                  </code>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This is your Nostr public identifier. Share your npub to receive messages or be mentioned.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
