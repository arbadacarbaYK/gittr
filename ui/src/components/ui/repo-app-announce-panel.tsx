"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { publishSoftwareAnnounce } from "@/lib/nostr/publish-software-announce";
import { resolveNostrSigner } from "@/lib/nostr/signer";
import type {
  ForgeReleasesOk,
  ForgeReleasesResult,
} from "@/lib/repo/forge-releases";
import { suggestAppIdFromRepo } from "@/lib/repo/forge-releases";
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

const ZAPSTORE_PUBLISH_DOCS = "https://zapstore.dev/docs/publish";

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
  } = props;
  const { publish, subscribe, defaultRelays, remoteSigner } = useNostrContext();

  const [loading, setLoading] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forge, setForge] = useState<ForgeReleasesOk | null>(null);
  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState(repoName);
  const [selectedApkUrl, setSelectedApkUrl] = useState<string>("");
  const [publishResult, setPublishResult] = useState<{
    appId: string;
    version: string;
    whitelistHint?: string;
  } | null>(null);

  const hasSource = Boolean(sourceUrl?.trim());

  const loadPreview = useCallback(
    async (withHash: boolean) => {
      if (!sourceUrl?.trim()) {
        setForge(null);
        setError("Link a forge URL first (Settings → source).");
        return;
      }
      setLoading(true);
      if (withHash) setHashing(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ sourceUrl: sourceUrl.trim() });
        if (withHash) qs.set("hash", "1");
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
        const first = data.release.apkAssets[0]?.downloadUrl || "";
        setSelectedApkUrl((prev) =>
          prev && data.release.apkAssets.some((a) => a.downloadUrl === prev)
            ? prev
            : first
        );
        if (!data.release.apkAssets.length) {
          setError(
            "Your repo or latest release has no .apk assets."
          );
        } else if (withHash) {
          const missing = data.release.apkAssets.filter((a) => !a.sha256);
          if (missing.length > 0) {
            setError(
              "Couldn’t verify the APK (download blocked or file too large)."
            );
          }
        }
      } catch (e) {
        setForge(null);
        setError(e instanceof Error ? e.message : "Could not load release");
      } finally {
        setLoading(false);
        setHashing(false);
      }
    },
    [sourceUrl, repoName]
  );

  useEffect(() => {
    if (!isOwnerSession) return;
    void loadPreview(false);
  }, [isOwnerSession, loadPreview]);

  useEffect(() => {
    setAppName(repoName);
  }, [repoName]);

  const selectedApk = useMemo(() => {
    if (!forge) return null;
    return (
      forge.release.apkAssets.find((a) => a.downloadUrl === selectedApkUrl) ||
      forge.release.apkAssets[0] ||
      null
    );
  }, [forge, selectedApkUrl]);

  const readyToPublish = Boolean(
    forge &&
      selectedApk?.sha256 &&
      appId.trim() &&
      appName.trim() &&
      isOwnerSession
  );

  const onPublish = async () => {
    if (!forge || !readyToPublish) return;
    setPublishing(true);
    setError(null);
    setPublishResult(null);
    try {
      let forgeForPublish = forge;
      if (!selectedApk?.sha256) {
        setHashing(true);
        const qs = new URLSearchParams({
          sourceUrl: sourceUrl!.trim(),
          hash: "1",
        });
        const res = await fetch(`/api/repo/forge-releases?${qs.toString()}`);
        const data = (await res.json()) as ForgeReleasesResult;
        if (!data.ok) throw new Error(data.message);
        forgeForPublish = data;
        setForge(data);
      }

      const result = await publishSoftwareAnnounce({
        input: {
          forge: forgeForPublish,
          appId: appId.trim(),
          appName: appName.trim(),
          summary: (repoSummary || "").slice(0, 280),
          selectedApkUrl: selectedApkUrl || undefined,
          nip34Address: nip34Address || undefined,
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

  return (
    <details className="group mt-3 overflow-hidden rounded-xl border border-[var(--color-border)] bg-gradient-to-b from-[var(--color-bg-secondary)] to-zinc-950/40 open:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-3 text-sm font-semibold tracking-tight text-white [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-primary)]/20 ring-1 ring-[var(--color-accent-primary)]/35">
          <Smartphone
            className="h-4 w-4 text-[var(--color-accent-primary)]"
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">Nostr Apps</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition duration-200 group-open:rotate-180 group-open:text-[var(--color-accent-primary)]" />
      </summary>

      <div className="space-y-3 border-t border-[var(--color-border)] px-3 pb-3.5 pt-3">
        <p className="text-[11px] leading-snug text-zinc-400">
          List an Android APK from your forge{" "}
          <strong className="font-medium text-zinc-300">Release</strong> on{" "}
          <Link
            href="/apps"
            className="text-[var(--color-link)] underline-offset-2 hover:underline"
          >
            Apps
          </Link>
          . APK stays on the forge — gittr only publishes the Nostr announce.
        </p>

        <div className="space-y-0.5 border-b border-zinc-800/80 pb-3">
          <ChecklistRow
            ok={hasSource}
            title={hasSource ? "Forge linked" : "Link GitHub / Codeberg / GitLab"}
          />
          <ChecklistRow
            ok={Boolean(forge?.release.apkAssets.length)}
            warning={Boolean(error && hasSource && !forge?.release.apkAssets.length)}
            title={
              forge?.release.apkAssets.length
                ? `${forge.release.tag} · ${forge.release.apkAssets.length} APK`
                : "Release needs an .apk asset"
            }
          />
          <ChecklistRow
            ok={Boolean(selectedApk?.sha256)}
            title={
              selectedApk?.sha256 ? "APK verified" : "Verify APK (one download)"
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

        {forge && forge.release.apkAssets.length > 0 ? (
          <div className="space-y-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
              <p className="text-[11px] font-medium text-zinc-200">
                {forge.release.name || forge.release.tag}
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-500">
                {forge.forge} · {forge.owner}/{forge.repo}
              </p>
              <ul className="mt-2 space-y-1">
                {forge.release.apkAssets.map((a) => (
                  <li key={a.downloadUrl}>
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name="announce-apk"
                        checked={selectedApkUrl === a.downloadUrl}
                        onChange={() => setSelectedApkUrl(a.downloadUrl)}
                      />
                      <span className="min-w-0">
                        <span className="break-all font-medium">{a.name}</span>
                        {a.size > 0 ? (
                          <span className="text-zinc-500">
                            {" "}
                            · {formatBytes(a.size)}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
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
            {hashing ? "Checking APK…" : "Check APK"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-auto w-full justify-start gap-2 py-2.5 text-left text-xs"
            disabled={!readyToPublish || publishing || hashing}
            onClick={() => void onPublish()}
          >
            {publishing ? "Publishing…" : "Publish on Nostr"}
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
                at the forge repo root (pubkey + repository), then publish
                again.{" "}
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
            the forge repo — see{" "}
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
