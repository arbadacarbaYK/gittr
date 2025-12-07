"use client";

import { useCallback, useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { nip19 } from "nostr-tools";
import useMetadata from "@/lib/nostr/useMetadata";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Package, X, Upload } from "lucide-react";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, saveStoredRepos, type StoredRepo, type RepoFileEntry } from "@/lib/repos/storage";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";
import { hasWriteAccess } from "@/lib/repo-permissions";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";

type ReleaseAsset = {
  name: string;
  platform: string;
  url?: string;
  size?: number;
  contentType?: string;
};

type Release = { 
  name: string; 
  tag_name: string; 
  body?: string; 
  published_at?: string; 
  html_url?: string; // Only set if explicitly provided, not auto-generated
  author?: { 
    login: string; 
    avatar_url?: string; // GitHub avatar (for imported releases)
    pubkey?: string; // Nostr pubkey (for native releases)
    picture?: string; // Nostr picture (for native releases)
  };
  assets?: ReleaseAsset[];
  prerelease?: boolean;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function RepoReleasesPage({ params }: { params: Promise<{ entity: string; repo: string }> }) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const [releases, setReleases] = useState<Release[]>([]);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [repoLogo, setRepoLogo] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const { name: userName, isLoggedIn, picture: userPicture } = useSession();
  const { pubkey: currentUserPubkey } = useNostrContext();
  const userMetadata = useMetadata();
  const ownerSlug = useMemo(() => slugify(userName || ""), [userName]);
  
  // Get metadata for release authors (Nostr pubkeys)
  const releaseAuthorPubkeys = useMemo(() => 
    releases
      .map(r => r.author?.pubkey)
      .filter((p): p is string => !!p),
    [releases]
  );
  const authorMetadata = useContributorMetadata(releaseAuthorPubkeys);
  
  // Check if user has write access (owner or maintainer) - required for creating releases
  const [hasWrite, setHasWrite] = useState(false);
  
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
      if (rec && currentUserPubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(rec, resolvedParams.entity);
        const userHasWrite = hasWriteAccess(currentUserPubkey, rec.contributors, repoOwnerPubkey);
        setHasWrite(userHasWrite);
      } else {
        setHasWrite(false);
      }
    } catch {
      setHasWrite(false);
    }
  }, [resolvedParams.entity, resolvedParams.repo, currentUserPubkey]);
  
  // Preserve branch in "Back to code" link if present
  const codeUrl = `/${resolvedParams.entity}/${resolvedParams.repo}${
    searchParams?.get("branch") ? `?branch=${encodeURIComponent(searchParams.get("branch")!)}` : ""
  }`;

  // Local form state for creating a release
  const [showForm, setShowForm] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [isPrerelease, setIsPrerelease] = useState(false);
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [assetName, setAssetName] = useState("");
  const [assetPlatform, setAssetPlatform] = useState("linux");

  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
      if (rec) {
      // Load releases from repo object (imported from GitHub or created natively)
      const repoWithReleases = rec as StoredRepo & { releases?: Release[] };
      setReleases((repoWithReleases.releases || []) as Release[]);
      setTags((rec.tags as string[] | undefined)?.map((t: string | { name: string }) => (typeof t === "string" ? t : t?.name)).filter(Boolean) || []);
      setSourceUrl(rec.sourceUrl);
        // Get repo logo if available
        const repoWithLogo = rec as StoredRepo & { logoUrl?: string };
        if (repoWithLogo.logoUrl) {
          setRepoLogo(repoWithLogo.logoUrl);
        } else {
          // Try to find logo file
          const logoFile = rec.files?.find((f: RepoFileEntry) => /(^|\/)logo\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(f.path));
          if (logoFile && rec.sourceUrl) {
            // Construct GitHub raw URL
            try {
              const url = new URL(rec.sourceUrl);
              const [owner, repoName] = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
              const branch = rec.defaultBranch || "main";
              setRepoLogo(`https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${logoFile.path}`);
            } catch {}
          }
        }
      }
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo]);

  const onCreateRelease = useCallback(() => {
    setShowForm(true);
    setTagInput("");
    setTitleInput("");
    setNotesInput("");
    setIsPrerelease(false);
    setAssets([]);
    setAssetName("");
    setAssetPlatform("linux");
  }, []);

  const addAsset = useCallback(() => {
    if (!assetName.trim()) return;
    const newAsset: ReleaseAsset = {
      name: assetName.trim(),
      platform: assetPlatform,
    };
    setAssets([...assets, newAsset]);
    setAssetName("");
    setAssetPlatform("linux");
  }, [assetName, assetPlatform, assets]);

  const removeAsset = useCallback((index: number) => {
    setAssets(assets.filter((_, i) => i !== index));
  }, [assets]);

  const submitRelease = useCallback(async () => {
    if (!tagInput.trim()) { alert("Tag is required"); return; }
    
    // CRITICAL: Require signature for creating releases (owner or maintainer must sign)
    if (!currentUserPubkey) {
      alert("Please log in to create releases");
      return;
    }
    
    // Get private key for signing (required for release creation)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;
    
    if (!privateKey && !hasNip07) {
      alert("Creating releases requires signature. Please configure NIP-07 extension or private key in settings.");
      return;
    }
    
    const tag = tagInput.trim();
    const name = titleInput.trim() || tag;
    const body = notesInput.trim();
    setCreating(true);
    try {
      const repos = loadStoredRepos();
      const idx = repos.findIndex((r: StoredRepo) => {
        const found = findRepoByEntityAndName<StoredRepo>([r], resolvedParams.entity, resolvedParams.repo);
        return found !== undefined;
      });
      if (idx < 0) { setCreating(false); return; }
      const now = new Date().toISOString();
      // For new releases, store creator's Nostr info (not GitHub)
      const author = { 
        login: ownerSlug || resolvedParams.entity,
        pubkey: currentUserPubkey || undefined,
        picture: userPicture || userMetadata.picture || undefined,
      };
      // Don't auto-generate html_url - only set if explicitly provided (for imported releases)
      // New releases created natively don't have GitHub URLs
      const rel: Release = { 
        name, 
        tag_name: tag, 
        body: body || undefined, 
        published_at: now, 
        html_url: undefined, // Only set for imported releases, not new ones
        author,
        assets: assets.length > 0 ? assets : undefined,
        prerelease: isPrerelease,
      };
      if (idx < 0 || !repos[idx]) {
        setCreating(false);
        return;
      }
      const repoWithReleases = repos[idx] as StoredRepo & { releases?: Release[] };
      const nextReleases = [rel, ...((repoWithReleases.releases || []) as Release[])];
      (repos[idx] as StoredRepo & { releases?: Release[] }).releases = nextReleases;
      const currentTags = repos[idx].tags as string[] | undefined;
      const tagSet = new Set<string>((currentTags || []).map((t: string | { name: string }) => (typeof t === "string" ? t : t?.name)));
      tagSet.add(tag);
      // StoredRepo.tags is string[], not { name: string }[]
      repos[idx].tags = Array.from(tagSet);
      saveStoredRepos(repos);
      setReleases(nextReleases);
      setTags(Array.from(tagSet));
      setShowForm(false);
      setTagInput(""); 
      setTitleInput(""); 
      setNotesInput("");
      setIsPrerelease(false);
      setAssets([]);
    } catch {
      // keep form open on error
    } finally {
      setCreating(false);
    }
  }, [notesInput, ownerSlug, resolvedParams.entity, resolvedParams.repo, tagInput, titleInput, isPrerelease, assets, currentUserPubkey, userPicture, userMetadata.picture]);

  const downloadZipUrl = (tag: string) => {
    if (!sourceUrl) return undefined;
    try {
      const u = new URL(sourceUrl);
      const [owner, repo] = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      return `https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(tag)}.zip`;
    } catch {
      return undefined;
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Releases</h2>
        <div className="flex items-center gap-3">
          {hasWrite && (
            <Button onClick={onCreateRelease} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New release
            </Button>
          )}
          <Link href={codeUrl} className="text-purple-500 hover:underline">Back to code</Link>
        </div>
      </div>
      {hasWrite && showForm && (
        <div className="mt-4 border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h3 className="text-lg font-semibold mb-4">Create a new release</h3>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Tag * (e.g., v1.0.0)</label>
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                placeholder="v1.0.0"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-2">Title</label>
              <Input
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                placeholder="Release title (optional)"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>
          </div>
          
          <div className="mt-4">
            <label className="block text-sm text-gray-300 mb-2">Release notes (markdown)</label>
            <Textarea
              value={notesInput}
              onChange={e => setNotesInput(e.target.value)}
              placeholder="What's changed in this release?"
              rows={8}
              className="bg-[#0E1116] border-[#383B42] text-white font-mono text-sm"
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              id="prerelease"
              checked={isPrerelease}
              onChange={e => setIsPrerelease(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="prerelease" className="text-sm text-gray-300 cursor-pointer">
              This is a pre-release
            </label>
          </div>

          {/* Assets/Artifacts section */}
          <div className="mt-6 border-t border-[#383B42] pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-5 w-5 text-purple-500" />
              <h4 className="font-semibold">Release Assets</h4>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Add binaries, installers, or archives for different platforms. Users will be able to download these with the release.
            </p>
            
            <div className="space-y-2 mb-3">
              {assets.map((asset, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-[#0E1116] rounded border border-[#383B42]">
                  <Package className="h-4 w-4 text-purple-500" />
                  <span className="flex-1 text-sm">{asset.name}</span>
                  <span className="text-xs text-gray-400 px-2 py-1 bg-purple-900/20 rounded">{asset.platform}</span>
                  <button
                    onClick={() => removeAsset(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                value={assetName}
                onChange={e => setAssetName(e.target.value)}
                placeholder="Asset name (e.g., app-linux.tar.gz)"
                className="bg-[#0E1116] border-[#383B42] text-white"
                onKeyPress={e => e.key === "Enter" && addAsset()}
              />
              <select
                value={assetPlatform}
                onChange={e => setAssetPlatform(e.target.value)}
                className="bg-[#0E1116] border border-[#383B42] text-white rounded px-3 py-2"
              >
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
                <option value="macos">macOS</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
                <option value="web">Web</option>
                <option value="source">Source</option>
                <option value="other">Other</option>
              </select>
              <Button
                type="button"
                onClick={addAsset}
                variant="outline"
                className="flex items-center gap-2"
                disabled={!assetName.trim()}
              >
                <Upload className="h-4 w-4" />
                Add Asset
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              💡 Tip: Upload the actual files separately and link them. For now, this stores asset metadata. 
              In production, you would upload files to a storage service (S3, IPFS, etc.) and store the URLs.
            </p>
          </div>
          
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={submitRelease} disabled={creating || !tagInput.trim()}>
              {creating ? "Creating…" : "Create release"}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {releases.length === 0 ? (
        <p className="text-gray-400 mt-4">No releases yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {releases.map((r, i) => {
            // Determine icon to show: repo logo → GitHub avatar (imported) / Nostr creator (native) → nostricon
            // GitHub creates an avatar for everyone, so imported releases will always have avatar_url
            let iconUrl: string | undefined = undefined;
            let iconAlt = "Release";
            
            // Priority 1: Repo logo (if available) - shows for all releases
            if (repoLogo) {
              iconUrl = repoLogo;
              iconAlt = "Repo";
            }
            // Priority 2: GitHub avatar (for imported releases - GitHub always provides avatars)
            else if (r.author?.avatar_url) {
              iconUrl = r.author.avatar_url;
              iconAlt = r.author.login || "GitHub";
            }
            // Priority 3: Nostr creator picture (for native releases)
            else if (r.author?.pubkey && r.author?.picture) {
              iconUrl = r.author.picture;
              iconAlt = r.author.login || "Creator";
            }
            // Priority 4: Nostr metadata picture (if pubkey exists but no picture in author)
            else if (r.author?.pubkey && authorMetadata[r.author.pubkey]?.picture) {
              iconUrl = authorMetadata[r.author.pubkey]?.picture;
              iconAlt = r.author.login || "Creator";
            }
            // Priority 5: Generate nostricon if we have a pubkey
            else if (r.author?.pubkey) {
              try {
                const npub = nip19.npubEncode(r.author.pubkey);
                iconUrl = `https://nostrcheck.me/api/v1/badges/nostrich/${npub}`;
                iconAlt = r.author.login || "Nostr";
              } catch {}
            }
            
            return (
            <li key={i} className="border border-[#383B42] rounded p-4">
              <div className="flex items-center gap-2">
                {iconUrl ? (
                  <img 
                    src={iconUrl} 
                    alt={iconAlt} 
                    className="h-6 w-6 rounded-full object-cover"
                    onError={(e) => {
                      // Fallback to nostricon if image fails
                      const target = e.currentTarget;
                      if (r.author?.pubkey && iconUrl && !iconUrl.includes('nostrcheck.me')) {
                        try {
                          const npub = nip19.npubEncode(r.author.pubkey);
                          target.src = `https://nostrcheck.me/api/v1/badges/nostrich/${npub}`;
                        } catch {}
                      } else {
                        target.style.display = 'none';
                      }
                    }}
                  />
                ) : null}
                <div className="font-semibold">{r.name || r.tag_name}</div>
                <span className="text-gray-400">({r.tag_name})</span>
              </div>
              <div className="text-gray-400 text-sm mt-1">{r.published_at ? formatDateTime24h(r.published_at) : ""}</div>
              {r.prerelease && (
                <span className="inline-block px-2 py-1 bg-yellow-900/30 text-yellow-400 rounded text-xs mt-1">Pre-release</span>
              )}
              {r.body && (
                <div className="text-sm mt-2 text-gray-300 whitespace-pre-wrap">{r.body}</div>
              )}
              
              {/* Release Assets */}
              {r.assets && r.assets.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#383B42]">
                  <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Assets ({r.assets.length})
                  </h5>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {r.assets.map((asset, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-[#0E1116] rounded border border-[#383B42] hover:border-purple-500/50 transition">
                        <Package className="h-4 w-4 text-purple-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{asset.name}</div>
                          <div className="text-xs text-gray-400">{asset.platform}</div>
                        </div>
                        {asset.url && (
                          <a
                            href={asset.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-500 hover:underline text-xs"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3 mt-4">
                {downloadZipUrl(r.tag_name) && (
                  <a href={downloadZipUrl(r.tag_name)} className="text-purple-500 hover:underline text-sm" target="_blank" rel="noopener noreferrer">
                    Download .zip
                  </a>
                )}
                {/* Only show "View on GitHub" if html_url is explicitly set (not auto-generated) */}
                {r.html_url && (
                  <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:underline text-sm">
                    View on GitHub
                  </a>
                )}
              </div>
            </li>
          );
          })}
        </ul>
      )}
    </section>
  );
}

