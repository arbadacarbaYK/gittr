"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBridgeRead } from "@/lib/nostr/bridge-read";
import { loadStoredRepos } from "@/lib/repos/storage";
import {
  type ManifestPackage,
  isManifestPath,
  mergeManifestPackages,
  parseManifest,
} from "@/lib/security/dependency-manifest-parser";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
  resolveEntityToPubkeyAsync,
} from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";

type Advisory = {
  id: string;
  aliases: string[];
  summary: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  url: string;
  package: { ecosystem: string; name: string; version: string };
  direct: boolean;
  precision: "pinned" | "range-min";
};

type AuditState =
  | { phase: "idle" }
  | { phase: "loading"; note: string }
  | {
      phase: "done";
      advisories: Advisory[];
      scanned: number;
      manifests: number;
    }
  | { phase: "empty"; reason: string }
  | { phase: "error"; message: string };

const MAX_MANIFESTS = 12;

const severityStyle: Record<Advisory["severity"], string> = {
  CRITICAL: "bg-red-950 text-red-300 border-red-800",
  HIGH: "bg-orange-950 text-orange-300 border-orange-800",
  MODERATE: "bg-yellow-950 text-yellow-300 border-yellow-800",
  LOW: "bg-sky-950 text-sky-300 border-sky-800",
  UNKNOWN: "bg-gray-800 text-gray-300 border-gray-700",
};

export function RepoSecurityAudit({
  entity,
  repo,
  branch,
}: {
  entity: string;
  repo: string;
  branch: string;
}) {
  const [state, setState] = useState<AuditState>({ phase: "idle" });
  const ranRef = useRef(false);

  const resolveOwnerAndName = useCallback(async (): Promise<{
    ownerPubkey: string;
    repoName: string;
  } | null> => {
    const repos = loadStoredRepos();
    const stored =
      findRepoByEntityAndName<any>(repos, entity, repo) ?? ({ entity, repo } as any);
    let ownerPubkey =
      getRepoOwnerPubkey(stored, entity) || resolveEntityToPubkey(entity, stored);
    if (!ownerPubkey) {
      ownerPubkey =
        resolveEntityToPubkey(entity) ||
        (await resolveEntityToPubkeyAsync(entity)) ||
        "";
    }
    if (!ownerPubkey) return null;
    let repoName =
      stored?.repositoryName || stored?.repo || stored?.name || repo;
    if (repoName.includes("/")) repoName = repoName.split("/").pop() || repoName;
    repoName = repoName.replace(/\.git$/, "");
    return { ownerPubkey: ownerPubkey.toLowerCase(), repoName };
  }, [entity, repo]);

  const fetchManifestContent = useCallback(
    async (
      ownerPubkey: string,
      repoName: string,
      path: string
    ): Promise<string | null> => {
      try {
        const res = await fetchBridgeRead(
          `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
            ownerPubkey
          )}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(
            path
          )}&branch=${encodeURIComponent(branch)}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.content === "string" ? data.content : null;
      } catch {
        return null;
      }
    },
    [branch]
  );

  const runAudit = useCallback(async () => {
    setState({ phase: "loading", note: "Resolving repository…" });
    const resolved = await resolveOwnerAndName();
    if (!resolved) {
      setState({
        phase: "empty",
        reason:
          "Open the Code tab once so this repo is cached, then return here.",
      });
      return;
    }
    const { ownerPubkey, repoName } = resolved;

    setState({ phase: "loading", note: "Reading manifests…" });
    let files: Array<{ path: string }> = [];
    try {
      const res = await fetchBridgeRead(
        `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(
          ownerPubkey
        )}&repo=${encodeURIComponent(repoName)}&branch=${encodeURIComponent(
          branch
        )}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.files)) files = data.files;
      }
    } catch {
      /* ignore — handled below */
    }

    const manifestPaths = files
      .map((f) => f.path)
      .filter((p) => typeof p === "string" && isManifestPath(p))
      .slice(0, MAX_MANIFESTS);

    if (manifestPaths.length === 0) {
      setState({
        phase: "empty",
        reason:
          "No supported manifests found (package.json, package-lock.json, yarn.lock, requirements.txt, go.mod, Cargo.lock, Gemfile.lock, composer.lock).",
      });
      return;
    }

    const groups: ManifestPackage[][] = [];
    for (const path of manifestPaths) {
      const content = await fetchManifestContent(ownerPubkey, repoName, path);
      if (content) groups.push(parseManifest(path, content));
    }
    const packages = mergeManifestPackages(groups);
    if (packages.length === 0) {
      setState({
        phase: "empty",
        reason: `Found ${manifestPaths.length} manifest(s) but no version-pinned packages to check.`,
      });
      return;
    }

    setState({
      phase: "loading",
      note: `Checking ${packages.length} packages against OSV.dev…`,
    });
    try {
      const res = await fetch("/api/security/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packages }),
      });
      if (!res.ok) {
        setState({
          phase: "error",
          message: "Vulnerability service is unavailable right now.",
        });
        return;
      }
      const data = await res.json();
      setState({
        phase: "done",
        advisories: Array.isArray(data?.advisories) ? data.advisories : [],
        scanned: Number(data?.scanned) || packages.length,
        manifests: manifestPaths.length,
      });
    } catch {
      setState({
        phase: "error",
        message: "Could not reach the vulnerability service.",
      });
    }
  }, [branch, fetchManifestContent, resolveOwnerAndName]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void runAudit();
  }, [runAudit]);

  return (
    <section className="mb-6 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
          <ShieldAlert className="h-4 w-4 text-[var(--color-accent-primary)]" />
          Security audit
        </h3>
        <span className="text-xs text-[var(--color-text-secondary)]">
          Powered by{" "}
          <a
            href="https://osv.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--color-accent-primary)]"
          >
            OSV.dev
          </a>
        </span>
      </div>

      <div className="mt-3">
        {state.phase === "loading" && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {state.note}
          </p>
        )}

        {state.phase === "empty" && (
          <p className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            {state.reason}
          </p>
        )}

        {state.phase === "error" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => void runAudit()}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-bg-primary)]"
            >
              Retry
            </button>
          </div>
        )}

        {state.phase === "done" && state.advisories.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-green-400">
            <ShieldCheck className="h-4 w-4" />
            No known vulnerabilities across {state.scanned} package(s).
          </p>
        )}

        {state.phase === "done" && state.advisories.length > 0 && (
          <AdvisoryList
            advisories={state.advisories}
            scanned={state.scanned}
          />
        )}
      </div>
    </section>
  );
}

function AdvisoryList({
  advisories,
  scanned,
}: {
  advisories: Advisory[];
  scanned: number;
}) {
  const counts = advisories.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, {});
  const order: Advisory["severity"][] = [
    "CRITICAL",
    "HIGH",
    "MODERATE",
    "LOW",
    "UNKNOWN",
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-text-primary)]">
          {advisories.length} advisory(ies) across {scanned} package(s):
        </span>
        {order
          .filter((s) => counts[s])
          .map((s) => (
            <span
              key={s}
              className={`rounded border px-2 py-0.5 text-xs font-medium ${severityStyle[s]}`}
            >
              {counts[s]} {s.toLowerCase()}
            </span>
          ))}
      </div>

      <ul className="space-y-2">
        {advisories.map((a, idx) => {
          const cve = a.aliases.find((x) => x.startsWith("CVE-"));
          const label = cve || a.id;
          return (
            <li
              key={`${a.id}-${a.package.name}-${idx}`}
              className="rounded border border-[var(--color-border)] p-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        severityStyle[a.severity]
                      }`}
                    >
                      {a.severity}
                    </span>
                    <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {a.package.name}@{a.package.version}
                    </span>
                    {!a.direct && (
                      <span className="text-[10px] text-[var(--color-text-secondary)]">
                        transitive
                      </span>
                    )}
                    {a.precision === "range-min" && (
                      <span
                        className="text-[10px] text-[var(--color-text-secondary)]"
                        title="Version inferred from a package.json range (lower bound), not a lockfile"
                      >
                        approx. version
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {a.summary}
                  </p>
                </div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-[var(--color-accent-primary)] underline underline-offset-2 hover:opacity-80"
                >
                  {label}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
