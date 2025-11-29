"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { createRepositoryEvent } from "@/lib/nostr/events";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { nip19 } from "nostr-tools";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, type StoredRepo } from "@/lib/repos/storage";
import { publishWithConfirmation, storeRepoEventId } from "@/lib/nostr/publish-with-confirmation";

function slugify(text: string): string {
  // CRITICAL: Normalize repo names for NEW repos to URL-safe format
  // Use hyphens (kebab-case) instead of underscores for better URL readability
  // This ensures new repos have clean URLs, but imported repos preserve their original names
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-') // Replace spaces with hyphens (kebab-case)
    .replace(/[_-]+/g, '-') // Collapse multiple underscores/hyphens into single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  // Never default to "user" - return the slug or empty string
  return slug || "";
}

function NewRepoPageContent() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [readme, setReadme] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { name: userName, isLoggedIn } = useSession();
  const { publish, subscribe, defaultRelays, pubkey } = useNostrContext();
  
  // If called as a fork (/new?fork=entity/repo), prefill and stage source
  const forkParam = searchParams?.get("fork") || "";
  const forkParts = forkParam.split("/").filter(Boolean);
  const forkEntity = forkParts[0] || "";
  const forkRepo = forkParts[1] || "";
  const [forkSource, setForkSource] = useState<any | null>(null);
  
  // Prefill name for forks and load source repo from localStorage
  useEffect(() => {
    try {
      if (forkEntity && forkRepo) {
        const repos = loadStoredRepos();
        const source = findRepoByEntityAndName<StoredRepo>(repos, forkEntity, forkRepo);
        if (source) {
          setForkSource(source);
          if (!name) setName(`${source.name || forkRepo}-fork`);
          const sourceWithReadme = source as StoredRepo & { readme?: string };
          if (sourceWithReadme.readme) setReadme(sourceWithReadme.readme);
        }
      }
    } catch {}
  }, [forkEntity, forkRepo]);
  
  // Helper to get entity slug and display name - use Nostr pubkey, not username slug
  const getEntityInfo = () => {
    // Always use the logged-in user's Nostr pubkey for entity (npub format - GRASP protocol standard)
    if (!isLoggedIn || !pubkey || typeof pubkey !== "string") {
      throw new Error("You must be logged in with Nostr key to create a repository");
    }
    const pubkeyStr = String(pubkey); // Ensure it's a string
    if (!/^[0-9a-f]{64}$/i.test(pubkeyStr)) {
      throw new Error("Invalid pubkey format");
    }
    const displayName = (userName && userName !== "Anonymous Nostrich" && userName.trim() !== "") 
      ? userName.trim() 
      : pubkeyStr.slice(0, 8);
    // CRITICAL: Use npub format for entity (GRASP protocol standard, matches URLs)
    let entityNpub: string;
    try {
      entityNpub = nip19.npubEncode(pubkeyStr);
    } catch (e) {
      throw new Error("Failed to encode npub");
    }
    console.log("getEntityInfo:", { userName, isLoggedIn, displayName, entity: entityNpub, pubkey: pubkeyStr.slice(0, 8) });
    return { entitySlug: entityNpub, displayName };
  };

  async function submit() {
    setStatus("Working…");
    let entityInfo;
    try {
      entityInfo = getEntityInfo();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      return;
    }
    if (url) {
      const r = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: url }) });
      const d = await r.json();
      if (d.status === "completed") {
        // Slugify the imported repo name to ensure URL-safe format
        const importedRepoSlug = slugify(d.repo || d.slug);
        if (!importedRepoSlug) {
          setStatus(`Import failed: Repository name "${d.repo || d.slug}" is not valid for URL`);
          return;
        }
        setStatus(`Imported ${entityInfo.entitySlug}/${importedRepoSlug}`);
        setReadme(d.readme || "");
        
        // store repo locally for listing - always use current user's Nostr pubkey as entity
        try {
          const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
          // For imports, use GitHub repo name but keep user's Nostr pubkey as entity
          const entity = entityInfo.entitySlug; // Use npub format (GRASP protocol standard)
          const repo = importedRepoSlug; // Use slugified version
          const exists = repos.some((r: any) => {
            const found = findRepoByEntityAndName<StoredRepo>([r], entity, repo);
            return found !== undefined || r.slug === repo;
          });
          // Ensure current user (owner) is ALWAYS in contributors array with pubkey for icon resolution
          // GitHub contributors won't have pubkeys, but we add the current user as owner
          let contributors: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string}> = [...(d.contributors || [])];
          
          // Always ensure owner is present (replace if exists, add if not)
          if (pubkey) {
            const existingOwnerIdx = contributors.findIndex((c: any) => c.pubkey === pubkey);
            const ownerContributor = { pubkey, name: entityInfo.displayName, weight: 100 };
            if (existingOwnerIdx >= 0) {
              contributors[existingOwnerIdx] = ownerContributor; // Replace with owner weight
            } else {
              contributors.unshift(ownerContributor); // Add owner at the beginning
            }
          }
          
          // CRITICAL: Preserve original GitHub repo name (with dots) in 'name' field for display
          // Use slugified version for URLs (slug, repo, repositoryName)
          const originalRepoName = d.repo || d.slug || name || importedRepoSlug; // Original name from GitHub (may have dots)
          
          const rec = { 
            slug: importedRepoSlug, // Use slugified repo name for URLs
            entity, 
            entityDisplayName: entityInfo.displayName, 
            repo: importedRepoSlug, // Use slugified version for URLs
            repositoryName: importedRepoSlug, // CRITICAL: Store exact repositoryName for git-nostr-bridge compatibility
            name: originalRepoName, // CRITICAL: Preserve original GitHub name (with dots) for display
            // Always set ownerPubkey for reliable ownership detection
            ownerPubkey: pubkey || undefined,
            sourceUrl: url, 
            forkedFrom: url, 
            readme: d.readme, 
            files: d.files, 
            description: d.description,
            stars: d.stars,
            forks: d.forks,
            languages: d.languages,
            topics: d.topics,
            // Always include contributors array (never undefined) - at minimum the owner
            contributors: contributors.length > 0 ? contributors : (pubkey ? [{ pubkey, name: entityInfo.displayName, weight: 100 }] : []),
            defaultBranch: d.defaultBranch,
            branches: d.branches || [],
            tags: d.tags || [],
            releases: d.releases || [],
            createdAt: Date.now() 
          };
          // CRITICAL: Log entity to verify it's correct
          console.log("🔄 Importing via new page with entity:", {
            entity: rec.entity,
            entityDisplayName: rec.entityDisplayName,
            ownerPubkey: rec.ownerPubkey?.slice(0, 8),
            expectedEntity: entityInfo.entitySlug,
            pubkey: pubkey?.slice(0, 8),
            repoName: rec.name
          });
          localStorage.setItem("gittr_repos", JSON.stringify(exists ? repos : [rec, ...repos]));
          
          // Dispatch event to update repositories page
          window.dispatchEvent(new CustomEvent("gittr:repo-created"));
          
          // Publish to Nostr with ALL metadata so it persists across ports
          if (publish && pubkey) {
            try {
              const privateKey = await getNostrPrivateKey();
              if (privateKey) {
                const repoEvent = createRepositoryEvent(
                  {
                    repositoryName: repo,
                    publicRead: true,
                    publicWrite: false,
                    description: d.description || `Imported from ${url}`,
                    sourceUrl: url,
                    forkedFrom: url,
                    readme: d.readme,
                    files: d.files,
                    stars: d.stars,
                    forks: d.forks,
                    languages: d.languages,
                    topics: d.topics || [],
                    // CRITICAL: Use rec.contributors which has owner properly set, not d.contributors
                    contributors: rec.contributors || (pubkey ? [{ pubkey, name: entityInfo.displayName, weight: 100 }] : []),
                    defaultBranch: d.defaultBranch,
                    branches: d.branches || [],
                    releases: d.releases || [],
                  },
                  privateKey
                );
                
                publish(repoEvent, defaultRelays);
                console.log("Published imported repo to Nostr with full metadata");
              }
            } catch (error: any) {
              console.error("Failed to publish imported repo to Nostr:", error);
            }
          }
        } catch {}
        setTimeout(()=> router.push("/repositories"), 600);
      } else {
        setStatus(`Import failed: ${d.status}`);
      }
    } else {
      // Create new repo - slugify the name to ensure URL-safe format
      const repoSlug = slugify(name || "repo");
      if (!repoSlug) {
        setStatus("Error: Repository name is not valid for URL");
        return;
      }
      const entity = entityInfo.entitySlug; // This is npub format (GRASP protocol standard)
      
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const exists = repos.some((r: any) => {
          const found = findRepoByEntityAndName<StoredRepo>([r], entity, repoSlug);
          return found !== undefined || r.slug === repoSlug;
        });
        // If forking, copy source repo files/readme/metadata
        const isFork = !!(forkEntity && forkRepo && forkSource);
        // Ensure owner is ALWAYS in contributors array with pubkey for icon resolution
        let contributors: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string}> = [];
        
        if (isFork) {
          // When forking, include original contributors but ensure new owner is added
          contributors = [...(forkSource.contributors || [])];
            // Add new owner if not already present (or replace if present with lower weight)
            if (pubkey) {
              const existingOwnerIdx = contributors.findIndex((c: any) => c.pubkey === pubkey);
              const ownerContributor = { pubkey, name: entityInfo.displayName, weight: 100 };
              if (existingOwnerIdx >= 0) {
                contributors[existingOwnerIdx] = ownerContributor; // Replace with owner weight
              } else {
                contributors.unshift(ownerContributor); // Add owner at the beginning
              }
            }
        } else {
          // New repo - owner must always be present
          if (pubkey) {
            contributors = [{ pubkey, name: entityInfo.displayName, weight: 100 }];
          }
        }
        
        // Ensure we always have at least the owner (if pubkey exists)
        if (!contributors.length && pubkey) {
          contributors = [{ pubkey, name: entityInfo.displayName, weight: 100 }];
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
          files: isFork ? forkSource.files || [] : undefined,
          // Keep attribution of source
          forkedFrom: isFork ? (forkSource.sourceUrl || `/${forkEntity}/${forkRepo}`) : undefined,
          sourceUrl: isFork ? (forkSource.sourceUrl || undefined) : undefined,
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
              const ownerIndex = contributors.findIndex(c => c.pubkey === pubkey);
              if (ownerIndex >= 0) {
                // Move owner to first position and set weight to 100
                const owner = { ...contributors[ownerIndex], weight: 100 };
                const others = contributors.filter((_, i) => i !== ownerIndex);
                return [owner, ...others];
              } else {
                // Add owner at the beginning
                return [{ pubkey, name: entityInfo.displayName, weight: 100 }, ...contributors];
              }
            }
            return contributors;
          })(),
          defaultBranch: isFork ? forkSource.defaultBranch : undefined,
          branches: isFork ? forkSource.branches : undefined,
          releases: isFork ? forkSource.releases : undefined,
          createdAt: Date.now(),
        } as any;
        // CRITICAL: Ensure contributors array is saved with owner
        if (!rec.contributors || rec.contributors.length === 0) {
          if (pubkey) {
            rec.contributors = [{ pubkey, name: entityInfo.displayName, weight: 100 }];
          }
        }
        // CRITICAL: Log entity to verify it's correct
        console.log("🔄 Creating repo with entity:", {
          entity: rec.entity,
          entityDisplayName: rec.entityDisplayName,
          ownerPubkey: rec.ownerPubkey?.slice(0, 8),
          expectedEntity: entityInfo.entitySlug,
          pubkey: pubkey?.slice(0, 8)
        });
        localStorage.setItem("gittr_repos", JSON.stringify(exists ? repos : [rec, ...repos]));
        
        // Dispatch event to update repositories page
        window.dispatchEvent(new CustomEvent("gittr:repo-created"));
        
        // Publish to Nostr with ALL metadata so it persists across ports
        if (publish && pubkey) {
          try {
            const privateKey = await getNostrPrivateKey();
            if (privateKey) {
              // Get git server URL from env or use domain from env
              const domain = process.env.NEXT_PUBLIC_DOMAIN || 
                (typeof window !== 'undefined' ? window.location.host : '');
              const gitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL || 
                (domain ? `https://${domain}` : (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : ''));
              
              // Get relays from context (already includes user-configured relays)
              const repoEvent = createRepositoryEvent(
                {
                  repositoryName: repoSlug,
                  publicRead: true,
                  publicWrite: false,
                  description: rec.description || `Repository: ${name || repoSlug}`,
                  forkedFrom: rec.forkedFrom,
                  sourceUrl: rec.sourceUrl,
                  readme: rec.readme,
                  files: rec.files,
                  topics: rec.topics,
                  languages: rec.languages,
                  // CRITICAL: Use rec.contributors which has owner properly set, not the contributors variable
                  contributors: rec.contributors || (pubkey ? [{ pubkey, name: entityInfo.displayName, weight: 100 }] : []),
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
              if (!subscribe) {
                setStatus("Error: Cannot publish - subscribe function not available");
                return;
              }
              
              setStatus("Publishing to Nostr...");
              const result = await publishWithConfirmation(
                publish,
                subscribe,
                repoEvent,
                defaultRelays,
                10000 // 10 second timeout
              );
              
              if (result.confirmed) {
                // Store event ID in repo data
                storeRepoEventId(repoSlug, rec.entity, result.eventId, true);
                console.log(`✅ Published repo to Nostr - Event ID: ${result.eventId}, Confirmed by: ${result.confirmedRelays.join(", ")}`);
                setStatus("Repository published to Nostr!");
              } else {
                console.warn(`⚠️ Published repo to Nostr but no confirmation received - Event ID: ${result.eventId}`);
                // Still store event ID even if not confirmed (might be delayed)
                storeRepoEventId(repoSlug, rec.entity, result.eventId, false);
                setStatus("Repository published (awaiting confirmation)");
              }
            }
          } catch (error: any) {
            console.error("Failed to publish repo to Nostr:", error);
          }
        }
      } catch {}
      setTimeout(()=> router.push("/repositories"), 400);
    }
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">Create repository</h1>
      <label className="block">Name</label>
      <input className="w-full border p-2 text-black" value={name} onChange={(e)=>setName(e.target.value)} placeholder="repo-name" />
      <label className="block mt-4">Import from URL (optional)</label>
      <input 
        className="w-full border p-2 text-black" 
        value={url} 
        onChange={(e)=>setUrl(e.target.value)}
        onBlur={(e) => {
          // Auto-add https:// for web URLs, but not for git@ or git:// URLs
          const value = e.target.value.trim();
          if (value && !value.startsWith("http://") && !value.startsWith("https://") && 
              !value.startsWith("git@") && !value.startsWith("git://") && 
              value.includes(".") && !value.includes("@")) {
            setUrl(`https://${value}`);
          }
        }}
        placeholder="github.com/owner/repo or https://... or git@host:owner/repo.git" 
      />
      <p className="text-sm mt-1">Examples: https://github.com/owner/repo(.git), https://host/owner/repo(.git), git@host:owner/repo(.git), git://host/owner/repo(.git)</p>
      <div className="flex gap-2 mt-4">
        <button className="border px-4 py-2" onClick={submit}>Create</button>
        <button 
          className="border px-4 py-2 inline-block"
          onClick={() => {
            // Extract GitHub username from URL field
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
                  const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
                  const pathParts = urlObj.pathname.split('/').filter(Boolean);
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
              window.location.href = `/import?user=${encodeURIComponent(githubUser)}`;
            } else {
              window.location.href = "/import";
            }
          }}
        >
          Bulk Import from GitHub
        </button>
      </div>
      {/* Debug: Show entity info */}
      {isLoggedIn && pubkey && (
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
      {status && (
        <div className="mt-4">
          <p>{status}</p>
          {readme && (
            <div className="mt-2 border p-2">
              <h2 className="font-semibold mb-2">README.md</h2>
              <pre className="whitespace-pre-wrap">{readme}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Mark as dynamic to prevent static generation (useSearchParams requires dynamic rendering)
export const dynamic = 'force-dynamic';

export default function NewRepoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white p-8">Loading...</div>}>
      <NewRepoPageContent />
    </Suspense>
  );
}


