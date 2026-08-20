"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RepoAppAnnouncePanel } from "@/components/ui/repo-app-announce-panel";
import { Textarea } from "@/components/ui/textarea";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareAsset,
} from "@/lib/nostr/nip82-software";
import {
  type RepoReleaseListItem,
  assetIdsAndRelayHintsFromRelease,
  mapSoftwareReleaseToRepoRelease,
  mergeForgeAndNostrReleases,
  parseAssetsById,
  parseMatchingRepoReleases,
} from "@/lib/nostr/nip82-repo-releases";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveSigningCredentials,
} from "@/lib/nostr/signer";
import { relaysForSoftwareCatalog } from "@/lib/nostr/software-catalog-relays";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useMetadata from "@/lib/nostr/useMetadata";
import useSession from "@/lib/nostr/useSession";
import { hasWriteAccess } from "@/lib/repo-permissions";
import { hydrateRepoFromGithub } from "@/lib/repos/repo-github-hub";
import {
  type RepoFileEntry,
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import {
  formatDate24h,
  formatDateTime24h,
  formatTime24h,
} from "@/lib/utils/date-format";
import {
  getRepoStorageKey,
  readRepoReleasesFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { syncGithubReleasesForRepo } from "@/lib/utils/sync-github-repo-releases";

import { Package, Plus, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { nip19 } from "nostr-tools";

type ReleaseAsset = {
  name: string;
  platform: string;
  url?: string;
  size?: number;
  contentType?: string;
  sha256?: string;
};

type Release = RepoReleaseListItem;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function RepoReleasesPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const [releases, setReleases] = useState<Release[]>([]);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [repoLogo, setRepoLogo] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const { name: userName, isLoggedIn, picture: userPicture } = useSession();
  const {
    pubkey: currentUserPubkey,
    remoteSigner,
    subscribe,
    defaultRelays,
  } = useNostrContext();
  const userMetadata = useMetadata();
  const ownerSlug = useMemo(() => slugify(userName || ""), [userName]);
  const [syncingReleases, setSyncingReleases] = useState(false);
  const [loadingNostrReleases, setLoadingNostrReleases] = useState(false);
  const [nostrReleasesSeen, setNostrReleasesSeen] = useState(false);
  const forgeReleasesRef = useRef<Release[]>([]);
  const nostrReleaseEventsRef = useRef<NostrEventLike[]>([]);
  const nostrAssetsByIdRef = useRef<Map<string, ParsedSoftwareAsset>>(
    new Map()
  );

  // Get metadata for release authors (Nostr pubkeys)
  const releaseAuthorPubkeys = useMemo(
    () => releases.map((r) => r.author?.pubkey).filter((p): p is string => !!p),
    [releases]
  );
  const authorMetadata = useContributorMetadata(releaseAuthorPubkeys);

  // Check if user has write access (owner or maintainer) - required for creating releases
  const [hasWrite, setHasWrite] = useState(false);
  const [isOwnerSession, setIsOwnerSession] = useState(false);
  const [ownerPubkeyHex, setOwnerPubkeyHex] = useState("");
  const [announcedAppId, setAnnouncedAppId] = useState<string | undefined>();
  const [repoSummary, setRepoSummary] = useState("");
  const [announceTag, setAnnounceTag] = useState<string | null>(null);

  const forgeSourceLinked = Boolean(
    sourceUrl &&
      (sourceUrl.includes("github.com") ||
        sourceUrl.includes("codeberg.org") ||
        sourceUrl.includes("gitlab.com"))
  );

  const nip34Address = useMemo(() => {
    const owner = ownerPubkeyHex.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(owner)) return null;
    return `30617:${owner}:${resolvedParams.repo}`;
  }, [ownerPubkeyHex, resolvedParams.repo]);

  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );
      let ownerHex = "";
      if (rec) {
        const repoOwnerPubkey = getRepoOwnerPubkey(rec, resolvedParams.entity);
        ownerHex = (repoOwnerPubkey || "").toLowerCase();
        setRepoSummary(String(rec.description || "").slice(0, 280));
        const announced = (rec as StoredRepo & { announcedAppId?: string })
          .announcedAppId;
        setAnnouncedAppId(
          typeof announced === "string" && announced.trim()
            ? announced.trim()
            : undefined
        );
      } else {
        setRepoSummary("");
        setAnnouncedAppId(undefined);
      }
      if (!ownerHex && resolvedParams.entity?.startsWith("npub")) {
        try {
          const decoded = nip19.decode(resolvedParams.entity);
          if (decoded.type === "npub") {
            ownerHex = String(decoded.data).toLowerCase();
          }
        } catch {
          /* ignore */
        }
      }
      setOwnerPubkeyHex(ownerHex);

      if (rec && currentUserPubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(rec, resolvedParams.entity);
        const userHasWrite = hasWriteAccess(
          currentUserPubkey,
          rec.contributors,
          repoOwnerPubkey
        );
        setHasWrite(userHasWrite);
        setIsOwnerSession(
          Boolean(
            ownerHex &&
              /^[0-9a-f]{64}$/.test(ownerHex) &&
              currentUserPubkey.toLowerCase() === ownerHex
          )
        );
      } else {
        setHasWrite(false);
        setIsOwnerSession(
          Boolean(
            ownerHex &&
              currentUserPubkey &&
              currentUserPubkey.toLowerCase() === ownerHex
          )
        );
      }
    } catch {
      setHasWrite(false);
      setIsOwnerSession(false);
      setOwnerPubkeyHex("");
      setRepoSummary("");
      setAnnouncedAppId(undefined);
    }
  }, [resolvedParams.entity, resolvedParams.repo, currentUserPubkey]);

  // Preserve branch in "Back to code" link if present
  const codeUrl = `/${resolvedParams.entity}/${resolvedParams.repo}${
    searchParams?.get("branch")
      ? `?branch=${encodeURIComponent(searchParams.get("branch")!)}`
      : ""
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

  const buildNostrReleaseRows = useCallback((): Release[] => {
    if (!ownerPubkeyHex || !/^[0-9a-f]{64}$/.test(ownerPubkeyHex)) return [];
    const matched = parseMatchingRepoReleases(nostrReleaseEventsRef.current, {
      ownerPubkeyHex,
      repoName: resolvedParams.repo,
      announcedAppId,
    });
    // Newest replaceable snapshot per version+channel
    const byKey = new Map<string, (typeof matched)[0]>();
    for (const r of matched) {
      const key = `${r.version.toLowerCase()}::${r.channel}`;
      const prev = byKey.get(key);
      if (!prev || r.createdAt > prev.createdAt) byKey.set(key, r);
    }
    return Array.from(byKey.values()).map((rel) => {
      const assets = rel.assetEventIds
        .map((id) => nostrAssetsByIdRef.current.get(id))
        .filter((a): a is ParsedSoftwareAsset => !!a);
      return mapSoftwareReleaseToRepoRelease(rel, assets);
    });
  }, [ownerPubkeyHex, resolvedParams.repo, announcedAppId]);

  const remountMergedReleases = useCallback(() => {
    setReleases(
      mergeForgeAndNostrReleases(
        forgeReleasesRef.current,
        buildNostrReleaseRows()
      )
    );
  }, [buildNostrReleaseRows]);

  const reloadRepoReleasesFromStorage = useCallback(() => {
    try {
      const fromBucket = readRepoReleasesFromLocalStorage(
        resolvedParams.entity,
        resolvedParams.repo
      ) as Release[];

      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );

      const fromRepo =
        rec &&
        Array.isArray((rec as StoredRepo & { releases?: Release[] }).releases)
          ? ((rec as StoredRepo & { releases?: Release[] })
              .releases as Release[])
          : [];

      const byTag = new Map<string, Release>();
      for (const r of [...fromRepo, ...fromBucket]) {
        const tag =
          (r.tag_name && String(r.tag_name)) ||
          (typeof (r as Release & { tag?: string }).tag === "string"
            ? (r as Release & { tag?: string }).tag!
            : "");
        if (!tag) continue;
        byTag.set(tag.toLowerCase(), { ...r, tag_name: tag, source: "local" });
      }
      const localRows = Array.from(byTag.values());
      forgeReleasesRef.current = localRows;
      setReleases(
        mergeForgeAndNostrReleases(localRows, buildNostrReleaseRows())
      );

      if (rec) {
        setTags(
          rec.tags
            ?.map((t: string | { name: string }) =>
              typeof t === "string" ? t : t?.name
            )
            .filter(Boolean) || []
        );
        setSourceUrl(rec.sourceUrl);
        const repoWithLogo = rec as StoredRepo & { logoUrl?: string };
        if (repoWithLogo.logoUrl) {
          setRepoLogo(repoWithLogo.logoUrl);
        } else {
          const logoFile = rec.files?.find((f: RepoFileEntry) =>
            /(^|\/)logo\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(f.path)
          );
          if (logoFile && rec.sourceUrl) {
            try {
              const url = new URL(rec.sourceUrl);
              const [owner, repoName] = url.pathname
                .replace(/\.git$/, "")
                .split("/")
                .filter(Boolean);
              const branch = rec.defaultBranch || "main";
              setRepoLogo(
                `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${logoFile.path}`
              );
            } catch {
              setRepoLogo(undefined);
            }
          } else {
            setRepoLogo(undefined);
          }
        }
      }
    } catch {
      /* keep prior state */
    }
  }, [
    resolvedParams.entity,
    resolvedParams.repo,
    buildNostrReleaseRows,
  ]);

  useEffect(() => {
    reloadRepoReleasesFromStorage();
  }, [reloadRepoReleasesFromStorage]);

  // Soft-refresh releases from GitHub when upstream is known (like Issues/PRs).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSyncingReleases(true);
      try {
        const repos = loadStoredRepos();
        const rec = findRepoByEntityAndName<StoredRepo>(
          repos,
          resolvedParams.entity,
          resolvedParams.repo
        );
        const { sourceUrl: resolved } = await hydrateRepoFromGithub(
          resolvedParams.entity,
          resolvedParams.repo,
          {
            repoRecord: rec,
            subscribe,
            defaultRelays,
          }
        );
        const url = resolved || rec?.sourceUrl || "";
        const forgeOk =
          url &&
          (url.includes("github.com") ||
            url.includes("codeberg.org") ||
            url.includes("gitlab.com"));
        if (forgeOk && !cancelled) {
          const merged = await syncGithubReleasesForRepo(
            resolvedParams.entity,
            resolvedParams.repo,
            url
          );
          if (!cancelled) {
            if (merged && merged.length > 0) {
              const forgeRows = merged.map((r) => ({
                ...r,
                tag_name: r.tag_name,
                source: "forge" as const,
              }));
              forgeReleasesRef.current = forgeRows;
              setReleases(
                mergeForgeAndNostrReleases(forgeRows, buildNostrReleaseRows())
              );
              setSourceUrl(url);
            } else {
              reloadRepoReleasesFromStorage();
            }
          }
        }
      } catch (e) {
        console.warn("[Releases] upstream sync failed:", e);
      } finally {
        if (!cancelled) setSyncingReleases(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    resolvedParams.entity,
    resolvedParams.repo,
    subscribe,
    defaultRelays,
    reloadRepoReleasesFromStorage,
    buildNostrReleaseRows,
  ]);

  // NIP-82 / Blossom releases (kind 30063 + 3063) — works without a forge sourceUrl.
  useEffect(() => {
    if (!subscribe || !ownerPubkeyHex || !/^[0-9a-f]{64}$/.test(ownerPubkeyHex)) {
      return;
    }
    let cancelled = false;
    setLoadingNostrReleases(true);
    setNostrReleasesSeen(false);
    nostrReleaseEventsRef.current = [];
    nostrAssetsByIdRef.current = new Map();

    const relays = [
      ...relaysForSoftwareCatalog(defaultRelays || []),
      "wss://relay.ngit.dev",
    ];
    const uniqueRelays = Array.from(new Set(relays.filter(Boolean)));
    const assetUnsubs: Array<() => void> = [];

    const requestAssets = (releaseEv: NostrEventLike) => {
      const parsed = parseMatchingRepoReleases([releaseEv], {
        ownerPubkeyHex,
        repoName: resolvedParams.repo,
        announcedAppId,
      })[0];
      if (!parsed) return;
      const { ids, relayHints } = assetIdsAndRelayHintsFromRelease(parsed);
      const missing = ids.filter((id) => !nostrAssetsByIdRef.current.has(id));
      if (missing.length === 0) {
        remountMergedReleases();
        return;
      }
      const assetRelays = Array.from(
        new Set([...uniqueRelays, ...relayHints])
      );
      const unsubAssets = subscribe(
        [{ kinds: [KIND_SOFTWARE_ASSET], ids: missing }],
        assetRelays,
        (event: NostrEventLike) => {
          if (cancelled) return;
          const parsedAssets = parseAssetsById([event]);
          let changed = false;
          for (const [id, asset] of parsedAssets) {
            if (!nostrAssetsByIdRef.current.has(id)) {
              nostrAssetsByIdRef.current.set(id, asset);
              changed = true;
            }
          }
          if (changed) remountMergedReleases();
        },
        12000
      );
      assetUnsubs.push(unsubAssets);
    };

    const unsubReleases = subscribe(
      [
        {
          kinds: [KIND_SOFTWARE_RELEASE],
          authors: [ownerPubkeyHex],
          limit: 200,
        },
      ],
      uniqueRelays,
      (event: NostrEventLike) => {
        if (cancelled) return;
        const matched = parseMatchingRepoReleases([event], {
          ownerPubkeyHex,
          repoName: resolvedParams.repo,
          announcedAppId,
        });
        if (matched.length === 0) return;
        const prev = nostrReleaseEventsRef.current.find((e) => e.id === event.id);
        if (!prev) {
          nostrReleaseEventsRef.current = [
            ...nostrReleaseEventsRef.current,
            event,
          ];
        } else if (event.created_at >= prev.created_at) {
          nostrReleaseEventsRef.current = nostrReleaseEventsRef.current.map(
            (e) => (e.id === event.id ? event : e)
          );
        } else {
          return;
        }
        setNostrReleasesSeen(true);
        remountMergedReleases();
        requestAssets(event);
      },
      400
    );

    const doneTimer = setTimeout(() => {
      if (!cancelled) setLoadingNostrReleases(false);
    }, 14000);

    return () => {
      cancelled = true;
      clearTimeout(doneTimer);
      try {
        unsubReleases();
      } catch {
        /* ignore */
      }
      for (const u of assetUnsubs) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, [
    subscribe,
    ownerPubkeyHex,
    resolvedParams.repo,
    announcedAppId,
    defaultRelays,
    remountMergedReleases,
  ]);

  useEffect(() => {
    window.addEventListener(
      "gittr:repo-updated",
      reloadRepoReleasesFromStorage
    );
    window.addEventListener(
      "gittr:releases-updated",
      reloadRepoReleasesFromStorage
    );
    return () => {
      window.removeEventListener(
        "gittr:repo-updated",
        reloadRepoReleasesFromStorage
      );
      window.removeEventListener(
        "gittr:releases-updated",
        reloadRepoReleasesFromStorage
      );
    };
  }, [reloadRepoReleasesFromStorage]);

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

  const removeAsset = useCallback(
    (index: number) => {
      setAssets(assets.filter((_, i) => i !== index));
    },
    [assets]
  );

  const submitRelease = useCallback(async () => {
    if (!tagInput.trim()) {
      alert("Tag is required");
      return;
    }

    // CRITICAL: Require signature for creating releases (owner or maintainer must sign)
    if (!currentUserPubkey) {
      alert("Please log in to create releases");
      return;
    }

    // Get private key for signing (required for release creation)
    const signingCreds = await resolveSigningCredentials({ remoteSigner });
    if (!signingCreds) {
      alert(NO_SIGNING_METHOD_MESSAGE);
      return;
    }
    const { hasNip07, privateKey } = signingCreds;

    if (!privateKey && !hasNip07) {
      alert(
        "Creating releases requires signature. Please configure NIP-07 extension or private key in settings."
      );
      return;
    }

    const tag = tagInput.trim();
    const name = titleInput.trim() || tag;
    const body = notesInput.trim();
    setCreating(true);
    try {
      const repos = loadStoredRepos();
      const idx = repos.findIndex((r: StoredRepo) => {
        const found = findRepoByEntityAndName<StoredRepo>(
          [r],
          resolvedParams.entity,
          resolvedParams.repo
        );
        return found !== undefined;
      });
      if (idx < 0) {
        setCreating(false);
        return;
      }
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
      const repoWithReleases = repos[idx] as StoredRepo & {
        releases?: Release[];
      };
      const nextReleases = [rel, ...(repoWithReleases.releases || [])];
      (repos[idx] as StoredRepo & { releases?: Release[] }).releases =
        nextReleases;
      const currentTags = repos[idx].tags;
      const tagSet = new Set<string>(
        (currentTags || []).map((t: string | { name: string }) =>
          typeof t === "string" ? t : t?.name
        )
      );
      tagSet.add(tag);
      // StoredRepo.tags is string[], not { name: string }[]
      repos[idx].tags = Array.from(tagSet);
      saveStoredRepos(repos);
      try {
        localStorage.setItem(
          getRepoStorageKey(
            "gittr_releases",
            resolvedParams.entity,
            resolvedParams.repo
          ),
          JSON.stringify(nextReleases)
        );
      } catch {
        /* quota */
      }
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
  }, [
    notesInput,
    ownerSlug,
    resolvedParams.entity,
    resolvedParams.repo,
    tagInput,
    titleInput,
    isPrerelease,
    assets,
    currentUserPubkey,
    userPicture,
    userMetadata.picture,
  ]);

  const downloadZipUrl = (tag: string) => {
    if (!sourceUrl) return undefined;
    try {
      const u = new URL(sourceUrl);
      const host = u.hostname.toLowerCase();
      const [owner, repo] = u.pathname
        .replace(/\.git$/, "")
        .split("/")
        .filter(Boolean);
      if (!owner || !repo) return undefined;
      const encTag = encodeURIComponent(tag);
      if (host.includes("github.com")) {
        return `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.zip`;
      }
      if (host.includes("codeberg.org")) {
        return `https://codeberg.org/${owner}/${repo}/archive/${encTag}.zip`;
      }
      if (host.includes("gitlab.com")) {
        return `https://gitlab.com/${owner}/${repo}/-/archive/${encTag}/${repo}-${encTag}.zip`;
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Releases</h2>
          {syncingReleases && (
            <p className="text-xs text-gray-400">Refreshing from forge…</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasWrite && (
            <Button
              onClick={onCreateRelease}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New release
            </Button>
          )}
          <Link href={codeUrl} className="text-purple-500 hover:underline">
            Back to code
          </Link>
        </div>
      </div>
      {hasWrite && showForm && (
        <div className="mt-4 border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h3 className="text-lg font-semibold mb-1">
            gittr listing (this browser)
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Saves tag/notes in this browser only. It does{" "}
            <strong className="font-medium text-gray-300">not</strong> upload
            installers, create a GitHub / Codeberg / GitLab Release, or list an
            app on{" "}
            <Link href="/apps" className="text-purple-400 hover:underline">
              /apps
            </Link>
            . Put real binaries on the forge Release first, then use{" "}
            <strong className="font-medium text-gray-300">
              Announce on Nostr
            </strong>{" "}
            on that tag. See{" "}
            <Link
              href="/help#releases"
              className="text-purple-400 hover:underline"
            >
              Help → Releases
            </Link>
            .
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-gray-300 mb-2">
                Tag * (e.g., v1.0.0)
              </label>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="v1.0.0"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-2">Title</label>
              <Input
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Release title (optional)"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm text-gray-300 mb-2">
              Release notes (markdown)
            </label>
            <Textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
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
              onChange={(e) => setIsPrerelease(e.target.checked)}
              className="w-4 h-4"
            />
            <label
              htmlFor="prerelease"
              className="text-sm text-gray-300 cursor-pointer"
            >
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
              Name/platform labels only for this local listing. Upload real
              files on the forge Release (or wait for Blossom upload later).
            </p>

            <div className="space-y-2 mb-3">
              {assets.map((asset, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 bg-[#0E1116] rounded border border-[#383B42]"
                >
                  <Package className="h-4 w-4 text-purple-500" />
                  <span className="flex-1 text-sm">{asset.name}</span>
                  <span className="text-xs text-gray-400 px-2 py-1 bg-purple-900/20 rounded">
                    {asset.platform}
                  </span>
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
                onChange={(e) => setAssetName(e.target.value)}
                placeholder="Asset name (e.g., app-linux.tar.gz)"
                className="bg-[#0E1116] border-[#383B42] text-white"
                onKeyPress={(e) => e.key === "Enter" && addAsset()}
              />
              <select
                value={assetPlatform}
                onChange={(e) => setAssetPlatform(e.target.value)}
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
              Binary upload to Blossom is not available yet — metadata only for
              now.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={submitRelease}
              disabled={creating || !tagInput.trim()}
            >
              {creating ? "Creating…" : "Save listing"}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isOwnerSession && forgeSourceLinked && announceTag ? (
        <div className="mt-4 mb-2" id="announce-forge-tag">
          <RepoAppAnnouncePanel
            key={announceTag}
            isOwnerSession
            variant="inline"
            defaultOpen
            preferredTag={announceTag}
            sourceUrl={sourceUrl}
            repoName={resolvedParams.repo}
            repoSummary={repoSummary}
            ownerPubkeyHex={ownerPubkeyHex}
            nip34Address={nip34Address}
            onAnnounced={(announcedAppId) => {
              try {
                const repos = loadStoredRepos();
                const updated = repos.map((r) => {
                  const matches =
                    (r.repo === resolvedParams.repo ||
                      r.slug === resolvedParams.repo) &&
                    r.entity === resolvedParams.entity;
                  if (!matches) return r;
                  return { ...r, announcedAppId };
                });
                saveStoredRepos(updated);
              } catch {
                /* ignore */
              }
            }}
          />
          <button
            type="button"
            className="mt-2 text-xs text-gray-500 hover:text-gray-300"
            onClick={() => setAnnounceTag(null)}
          >
            Close announce panel
          </button>
        </div>
      ) : null}

      {releases.length === 0 ? (
        <div className="mt-4 space-y-2 text-gray-400">
          {syncingReleases || loadingNostrReleases ? (
            <p>Loading releases from forge / Nostr…</p>
          ) : (
            <>
              <p>No releases yet.</p>
              <p className="text-sm text-gray-500">
                Forge Releases appear when this repo has a GitHub / Codeberg /
                GitLab source. Blossom / Zapstore (NIP-82) releases are loaded
                from Nostr even without a forge link
                {nostrReleasesSeen
                  ? " (events seen — assets may still be resolving)."
                  : "."}{" "}
                Browse installable apps at{" "}
                <Link
                  href="/apps"
                  className="text-purple-400 hover:text-purple-300"
                >
                  /apps
                </Link>
                .
              </p>
            </>
          )}
        </div>
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
            else if (
              r.author?.pubkey &&
              authorMetadata[r.author.pubkey]?.picture
            ) {
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
                        if (
                          r.author?.pubkey &&
                          iconUrl &&
                          !iconUrl.includes("nostrcheck.me")
                        ) {
                          try {
                            const npub = nip19.npubEncode(r.author.pubkey);
                            target.src = `https://nostrcheck.me/api/v1/badges/nostrich/${npub}`;
                          } catch {}
                        } else {
                          target.style.display = "none";
                        }
                      }}
                    />
                  ) : null}
                  <div className="font-semibold">{r.name || r.tag_name}</div>
                  <span className="text-gray-400">({r.tag_name})</span>
                  {r.source === "nostr" ? (
                    <span className="inline-block px-2 py-0.5 bg-purple-900/40 text-purple-300 rounded text-xs">
                      Nostr
                    </span>
                  ) : null}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {r.published_at ? formatDateTime24h(r.published_at) : ""}
                </div>
                {r.prerelease && (
                  <span className="inline-block px-2 py-1 bg-yellow-900/30 text-yellow-400 rounded text-xs mt-1">
                    Pre-release
                  </span>
                )}
                {r.body && (
                  <div className="text-sm mt-2 text-gray-300 whitespace-pre-wrap">
                    {r.body}
                  </div>
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
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 bg-[#0E1116] rounded border border-[#383B42] hover:border-purple-500/50 transition"
                        >
                          <Package className="h-4 w-4 text-purple-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{asset.name}</div>
                            <div className="text-xs text-gray-400">
                              {asset.platform}
                              {typeof asset.size === "number" && asset.size > 0
                                ? ` · ${
                                    asset.size < 1024
                                      ? `${asset.size} B`
                                      : asset.size < 1024 * 1024
                                      ? `${(asset.size / 1024).toFixed(1)} KB`
                                      : `${(asset.size / (1024 * 1024)).toFixed(
                                          1
                                        )} MB`
                                  }`
                                : ""}
                            </div>
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

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  {downloadZipUrl(r.tag_name) && (
                    <a
                      href={downloadZipUrl(r.tag_name)}
                      className="text-purple-500 hover:underline text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Source code (.zip)
                    </a>
                  )}
                  {/* Only show "View on GitHub" if html_url is explicitly set (not auto-generated) */}
                  {r.html_url && (
                    <a
                      href={r.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-500 hover:underline text-sm"
                    >
                      View on GitHub
                    </a>
                  )}
                  {isOwnerSession &&
                  forgeSourceLinked &&
                  (Boolean(r.html_url) ||
                    Boolean(r.assets?.some((a) => a.url))) ? (
                    <button
                      type="button"
                      className="text-purple-500 hover:underline text-sm"
                      onClick={() => {
                        setAnnounceTag(r.tag_name);
                        window.setTimeout(() => {
                          document
                            .getElementById("announce-forge-tag")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            });
                        }, 50);
                      }}
                    >
                      Announce on Nostr
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
