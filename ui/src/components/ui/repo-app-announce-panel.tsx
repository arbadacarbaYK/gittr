"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ZAPSTORE_PUBLISH_DOCS } from "@/lib/gittr-repo-links";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { pinReleaseAssetsToNgitBlossom } from "@/lib/nostr/pin-release-assets-to-blossom";
import { publishSoftwareAnnounce } from "@/lib/nostr/publish-software-announce";
import { resolveNostrSigner } from "@/lib/nostr/signer";
import {
  pickAnnouncePrimaryAsset,
  pickSiblingNip82Assets,
} from "@/lib/nostr/software-announce-build";
import type {
  ForgeReleasesOk,
  ForgeReleasesResult,
} from "@/lib/repo/forge-releases";
import {
  announceableForgeAssets,
  suggestAppIdFromRepo,
} from "@/lib/repo/forge-releases";
import { cn } from "@/lib/utils";

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Package,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import Link from "next/link";

type RepoAppAnnouncePanelProps = {
  isOwnerSession: boolean;
  sourceUrl?: string | null;
  repoName: string;
  repoSummary?: string;
  ownerPubkeyHex: string;
  /** Optional NIP-34 a-tag: 30617:pubkey:repo */
  nip34Address?: string | null;
  /** Persist app id onto the stored repo after a successful announce */
  onAnnounced?: (appId: string) => void;
  /**
   * Forge release tag to announce. Omit for latest (Code sidebar).
   * When set, queries `/api/repo/forge-releases?tag=…`.
   */
  preferredTag?: string | null;
  /** sidebar = auto-load latest; inline = lazy-load when opened (Releases tab). */
  variant?: "sidebar" | "inline";
  /** Start open (inline Releases panel after clicking Announce). */
  defaultOpen?: boolean;
};

function ChecklistRow(props: {
  ok: boolean;
  warning?: boolean;
  title: string;
}) {
  const { ok, warning, title } = props;
  const Icon = ok ? CheckCircle2 : Circle;
  const iconClass = ok
    ? "text-[var(--color-accent-secondary)]"
    : warning
    ? "text-amber-500/85"
    : "text-zinc-500";
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
      <span className="min-w-0 flex-1 text-xs font-medium tracking-tight text-zinc-100">
        {title}
      </span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!n || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function RepoAppAnnouncePanel(props: RepoAppAnnouncePanelProps) {
  const {
    isOwnerSession,
    sourceUrl,
    repoName,
    repoSummary,
    ownerPubkeyHex,
    nip34Address,
    onAnnounced,
    preferredTag,
    variant = "sidebar",
    defaultOpen = false,
  } = props;
  const { publish, subscribe, defaultRelays, remoteSigner } = useNostrContext();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const [loading, setLoading] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forge, setForge] = useState<ForgeReleasesOk | null>(null);
  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState(repoName);
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string>("");
  const [publishResult, setPublishResult] = useState<{
    appId: string;
    version: string;
    whitelistHint?: string;
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  const [pinToNgitBlossom, setPinToNgitBlossom] = useState(false);
  const [pinWarning, setPinWarning] = useState<string | null>(null);

  const hasSource = Boolean(sourceUrl?.trim());
  const tagForQuery = (preferredTag || "").trim();
  const isInline = variant === "inline";

  const loadPreview = useCallback(
    async (withHash: boolean) => {
      if (!sourceUrl?.trim()) {
        setForge(null);
        setError(
          "Link a GitHub, Codeberg, or GitLab source URL first (Settings → source)."
        );
        return;
      }
      setLoading(true);
      if (withHash) setHashing(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ sourceUrl: sourceUrl.trim() });
        if (withHash) qs.set("hash", "1");
        if (tagForQuery) qs.set("tag", tagForQuery);
        const res = await fetch(`/api/repo/forge-releases?${qs.toString()}`);
        const data = (await res.json()) as ForgeReleasesResult;
        if (!data.ok) {
          setForge(null);
          setError(data.message);
          return;
        }
        setForge(data);
        setAppId((prev) => prev || suggestAppIdFromRepo(data.repo));
        setAppName((prev) => prev || data.repo || repoName);
        const announceable = announceableForgeAssets(data.release.assets);
        const preferred = pickAnnouncePrimaryAsset(data);
        setSelectedAssetUrl((prev) =>
          prev && announceable.some((a) => a.downloadUrl === prev)
            ? prev
            : preferred.downloadUrl
        );
        if (announceable.length === 0) {
          setError(
            tagForQuery
              ? `Release “${data.release.tag}” has no announceable binaries.`
              : "Your repo or latest release has no announceable binaries."
          );
        } else if (withHash && announceable.every((a) => !a.sha256)) {
          setError(
            "Couldn’t verify the installers (download blocked or file too large)."
          );
        }
      } catch (e) {
        setForge(null);
        setError(e instanceof Error ? e.message : "Could not load release");
      } finally {
        setLoading(false);
        setHashing(false);
      }
    },
    [sourceUrl, repoName, tagForQuery]
  );

  // Sidebar: auto-preview latest on mount. Inline: only when opened.
  useEffect(() => {
    if (!isOwnerSession) return;
    if (isInline) return;
    void loadPreview(false);
  }, [isOwnerSession, isInline, loadPreview]);

  useEffect(() => {
    if (!isOwnerSession || !isInline) return;
    if (!panelOpen) return;
    void loadPreview(false);
  }, [isOwnerSession, isInline, panelOpen, loadPreview]);

  useEffect(() => {
    setAppName(repoName);
  }, [repoName]);

  useEffect(() => {
    setForge(null);
    setError(null);
    setPublishResult(null);
    setSelectedAssetUrl("");
  }, [tagForQuery]);

  useEffect(() => {
    if (!defaultOpen || !detailsRef.current) return;
    detailsRef.current.open = true;
    setPanelOpen(true);
  }, [defaultOpen, tagForQuery]);

  const announceable = useMemo(
    () => (forge ? announceableForgeAssets(forge.release.assets) : []),
    [forge]
  );

  const selectedAsset = useMemo(() => {
    if (!forge || announceable.length === 0) return null;
    return (
      announceable.find((a) => a.downloadUrl === selectedAssetUrl) ||
      pickAnnouncePrimaryAsset(forge, selectedAssetUrl || undefined)
    );
  }, [forge, announceable, selectedAssetUrl]);

  const siblingNip82Count = useMemo(() => {
    if (!forge || !selectedAsset) return 0;
    return pickSiblingNip82Assets(forge, selectedAsset).length;
  }, [forge, selectedAsset]);

  const readyToPublish = Boolean(
    forge &&
      selectedAsset?.sha256 &&
      appId.trim() &&
      appName.trim() &&
      isOwnerSession
  );

  const onPublish = async () => {
    if (!forge || !readyToPublish) return;
    const source = (sourceUrl || "").trim();
    if (!source) return;
    setPublishing(true);
    setError(null);
    setPublishResult(null);
    setPinWarning(null);
    try {
      let forgeForPublish = forge;
      if (!selectedAsset?.sha256) {
        setHashing(true);
        const qs = new URLSearchParams({
          sourceUrl: source,
          hash: "1",
        });
        if (tagForQuery) qs.set("tag", tagForQuery);
        const res = await fetch(`/api/repo/forge-releases?${qs.toString()}`);
        const data = (await res.json()) as ForgeReleasesResult;
        if (!data.ok) throw new Error(data.message);
        forgeForPublish = data;
        setForge(data);
      }

      let assetUrlOverrides: Record<string, string> | undefined;
      if (pinToNgitBlossom) {
        const signer = await resolveNostrSigner({
          remoteSigner,
          waitForRemote: true,
        });
        if (!signer) {
          throw new Error(
            "No signing method available. Use a NIP-07 extension or pair a remote signer."
          );
        }
        const pin = await pinReleaseAssetsToNgitBlossom({
          sourceUrl: source,
          tag: tagForQuery || null,
          forge: forgeForPublish,
          selectedUrl: selectedAssetUrl || undefined,
          ownerPubkeyHex,
          signEvent: (event) => signer.signEvent(event),
        });
        if (Object.keys(pin.overrides).length > 0) {
          assetUrlOverrides = pin.overrides;
        }
        if (pin.warnings.length > 0) {
          setPinWarning(pin.warnings.join(" "));
        }
      }

      const result = await publishSoftwareAnnounce({
        input: {
          forge: forgeForPublish,
          appId: appId.trim(),
          appName: appName.trim(),
          summary: (repoSummary || "").slice(0, 280),
          selectedAssetUrl: selectedAssetUrl || undefined,
          selectedApkUrl: selectedAssetUrl || undefined,
          nip34Address: nip34Address || undefined,
          assetUrlOverrides,
        },
        ownerPubkeyHex,
        defaultRelays: defaultRelays || [],
        resolveSigner: () =>
          resolveNostrSigner({ remoteSigner, waitForRemote: true }),
        publish: publish as any,
        subscribe: subscribe as any,
      });
      setPublishResult({
        appId: result.appId,
        version: result.version,
        whitelistHint: result.whitelistHint,
      });
      onAnnounced?.(result.appId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
      setHashing(false);
    }
  };

  if (!isOwnerSession) return null;

  const summaryLabel = tagForQuery
    ? `Announce ${tagForQuery}`
    : isInline
    ? "Announce on Nostr"
    : "Nostr Apps";

  return (
    <details
      ref={detailsRef}
      className={cn(
        "group overflow-hidden rounded-xl border border-[var(--color-border)] bg-gradient-to-b from-[var(--color-bg-secondary)] to-zinc-950/40 open:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        isInline ? "mt-0" : "mt-3"
      )}
      onToggle={(e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open;
        setPanelOpen(open);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-3 text-sm font-semibold tracking-tight text-white [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-primary)]/20 ring-1 ring-[var(--color-accent-primary)]/35">
          <Smartphone
            className="h-4 w-4 text-[var(--color-accent-primary)]"
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">{summaryLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition duration-200 group-open:rotate-180 group-open:text-[var(--color-accent-primary)]" />
      </summary>

      <div className="space-y-3 border-t border-[var(--color-border)] px-3 pb-3.5 pt-3">
        <p className="text-[11px] leading-snug text-zinc-400">
          {tagForQuery ? (
            <>
              Announce forge tag{" "}
              <strong className="font-medium text-zinc-300">
                {tagForQuery}
              </strong>{" "}
              on{" "}
              <Link
                href="/apps"
                className="text-[var(--color-link)] underline-offset-2 hover:underline"
              >
                Apps
              </Link>
              . Pick a hashed installer (APK, AppImage, DMG, tar.gz, …). An{" "}
              <strong className="font-medium text-zinc-300">.apk</strong> is
              preferred for Zapstore Android. Files stay on the forge — gittr
              only publishes Nostr events. Optional: pin a copy onto public
              Blossom hosts (not gittr’s Pages Blossom).
            </>
          ) : (
            <>
              List this release on{" "}
              <Link
                href="/apps"
                className="text-[var(--color-link)] underline-offset-2 hover:underline"
              >
                Apps
              </Link>
              . An <strong className="font-medium text-zinc-300">.apk</strong>{" "}
              is preferred for Zapstore Android; other NIP-82 binaries (tar.gz,
              AppImage, DMG, MSI/EXE, IPA) work as the main file. Extra files on
              the same forge Release are announced as extra assets when
              verified. Files stay on the forge — gittr only publishes the Nostr
              events. Optional pin uses public Blossom hosts, never
              blossom.gittr.space. The repo{" "}
              <strong className="font-medium text-zinc-300">Releases</strong>{" "}
              tab still lists every downloadable forge file.
            </>
          )}
        </p>

        <div className="space-y-0.5 border-b border-zinc-800/80 pb-3">
          <ChecklistRow
            ok={hasSource}
            title={
              hasSource ? "Source linked" : "Link GitHub / Codeberg / GitLab"
            }
          />
          <ChecklistRow
            ok={announceable.length > 0}
            warning={Boolean(error && hasSource && announceable.length === 0)}
            title={
              announceable.length
                ? `${forge?.release.tag} · ${announceable.length} installer${
                    announceable.length === 1 ? "" : "s"
                  }`
                : tagForQuery
                ? `Tag ${tagForQuery} needs an installer`
                : "Release needs an installer"
            }
          />
          <ChecklistRow
            ok={Boolean(forge?.release.apkAssets.length)}
            warning={Boolean(forge && !forge.release.apkAssets.length)}
            title={
              forge?.release.apkAssets.length
                ? `Zapstore · ${forge.release.apkAssets.length} APK`
                : "Zapstore Android needs an .apk (optional)"
            }
          />
          <ChecklistRow
            ok={Boolean(selectedAsset?.sha256)}
            title={
              selectedAsset?.sha256
                ? "File verified"
                : "Verify file (one download)"
            }
          />
        </div>

        {error ? (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-950/30 px-2.5 py-2 text-[11px] leading-snug text-amber-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {pinWarning ? (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-950/30 px-2.5 py-2 text-[11px] leading-snug text-amber-100"
            role="status"
          >
            {pinWarning}
          </div>
        ) : null}

        {forge && announceable.length > 0 ? (
          <div className="space-y-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
              <p className="text-[11px] font-medium text-zinc-200">
                {forge.release.name || forge.release.tag}
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-500">
                {forge.forge} · {forge.owner}/{forge.repo} · {forge.release.tag}
              </p>
              <ul className="mt-2 space-y-1">
                {announceable.map((a) => (
                  <li key={a.downloadUrl}>
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name={`announce-asset-${tagForQuery || "latest"}`}
                        checked={selectedAssetUrl === a.downloadUrl}
                        onChange={() => setSelectedAssetUrl(a.downloadUrl)}
                      />
                      <span className="min-w-0">
                        <span className="break-all font-medium">{a.name}</span>
                        {a.size > 0 ? (
                          <span className="text-zinc-500">
                            {" "}
                            · {formatBytes(a.size)}
                          </span>
                        ) : null}
                        {a.name.toLowerCase().endsWith(".apk") ? (
                          <span className="text-zinc-500"> · Zapstore</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {siblingNip82Count > 0 ? (
                <p className="mt-2 text-[10px] text-zinc-500">
                  Plus {siblingNip82Count} other verified platform file
                  {siblingNip82Count === 1 ? "" : "s"} on this tag will be
                  linked on the same Nostr release.
                </p>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                App id
              </span>
              <Input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="com.example.app"
                className="h-8 text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Display name
              </span>
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="h-8 text-xs"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2 pt-1 text-[11px] leading-snug text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={pinToNgitBlossom}
                onChange={(e) => setPinToNgitBlossom(e.target.checked)}
              />
              <span>
                Also pin a copy on public Blossom hosts (Primal, Ditto, Haven) —
                not gittr’s Pages Blossom. Default stays the forge download.
                Your signer will approve a Blossom upload, then the app events.
                If pin fails, announce still uses the forge URL.
              </span>
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto w-full justify-start gap-2 py-2 text-left text-xs font-normal"
            disabled={loading || !hasSource}
            onClick={() => void loadPreview(false)}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                loading && !hashing && "animate-spin"
              )}
            />
            {loading && !hashing ? "Looking up release…" : "Refresh release"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto w-full justify-start gap-2 py-2 text-left text-xs font-normal"
            disabled={loading || !forge}
            onClick={() => void loadPreview(true)}
          >
            <Package className={cn("h-3.5 w-3.5", hashing && "animate-spin")} />
            {hashing ? "Checking file…" : "Check file"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-auto w-full justify-start gap-2 py-2.5 text-left text-xs"
            disabled={!readyToPublish || publishing || hashing}
            onClick={() => void onPublish()}
          >
            {publishing
              ? pinToNgitBlossom
                ? "Pinning / publishing…"
                : "Publishing…"
              : "Publish on Nostr"}
          </Button>
        </div>

        {publishResult ? (
          <div className="rounded-md border border-[var(--color-accent-primary)]/35 bg-[var(--color-accent-primary)]/10 px-2.5 py-2 text-[11px] leading-snug text-[var(--color-text-primary)]">
            Live as {publishResult.appId}@{publishResult.version}. See{" "}
            <Link href="/apps" className="underline underline-offset-2">
              Apps
            </Link>
            .
            {publishResult.whitelistHint ? (
              <p className="mt-1.5 text-amber-100/95">
                For Zapstore catalog indexing, add{" "}
                <code className="rounded bg-zinc-900 px-1">zapstore.yaml</code>{" "}
                at the GitHub / Codeberg / GitLab repo root (pubkey +
                repository), then publish again.{" "}
                <a
                  href={ZAPSTORE_PUBLISH_DOCS}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Zapstore publish docs
                </a>
                .
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[10px] leading-snug text-zinc-500">
            Optional Zapstore: commit{" "}
            <code className="rounded bg-zinc-900 px-1">zapstore.yaml</code> in
            that source repo — see{" "}
            <a
              href={ZAPSTORE_PUBLISH_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-link)] underline-offset-2 hover:underline"
            >
              zapstore.dev/docs/publish
            </a>
            .
          </p>
        )}
      </div>
    </details>
  );
}
