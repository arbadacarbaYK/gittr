"use client";

import { useCallback, useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";

const LOCAL_AGENT_REPO_URL =
  "https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/local-agent";

/**
 * Lab board iframe must be same-origin (`/api/lab/snapshot`).
 * Site CSP is `frame-src 'self' …` — blob: URLs are blocked there.
 * Snapshot HTML is sanitized + CSP-locked on the API.
 */
export function LabDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const refreshMeta = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab/snapshot?format=json&_=${Date.now()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        updatedAt?: string;
        error?: string;
        hint?: string;
        html?: string;
      };
      if (!res.ok) {
        throw new Error(
          [data.error, data.hint].filter(Boolean).join(" — ") ||
            `Snapshot load failed (${res.status})`
        );
      }
      if (!data.html?.trim()) {
        throw new Error("Snapshot is empty");
      }
      setUpdatedAt(data.updatedAt || null);
      setFrameKey((k) => k + 1);
    } catch (e) {
      setUpdatedAt(null);
      setError(e instanceof Error ? e.message : "Could not load snapshot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const iframeSrc = `/api/lab/snapshot?v=${frameKey}`;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 py-4 md:px-4 lg:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Security lab</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Snapshot of an agent that maps the ecosystem’s dependencies and
            their security, starting from gittr as the seed repo. Not a live
            feed — display-only. Run it yourself:{" "}
            <a
              href={LOCAL_AGENT_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5eead4] underline underline-offset-2 hover:text-[#99f6e4]"
            >
              local-agent
            </a>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={LOCAL_AGENT_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            Run local-agent
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), "gap-2")}
            onClick={() => void refreshMeta()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[#383B42] bg-[#0E1116]/80 p-6 text-sm text-gray-300">
          <p>{error}</p>
          <p className="mt-3 text-gray-400">
            When a scrubbed snapshot is pushed to the gittr host, it appears
            here. Agent repo:{" "}
            <a
              href={LOCAL_AGENT_REPO_URL}
              className="text-[#5eead4] underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              local-agent
            </a>
            .
          </p>
        </div>
      ) : null}

      {loading && !updatedAt && !error ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading snapshot…
        </div>
      ) : null}

      {!error && (updatedAt || frameKey > 0) ? (
        <div className="overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]">
          {updatedAt ? (
            <div className="border-b border-[#383B42] px-4 py-2 text-xs text-gray-500">
              Snapshot from {new Date(updatedAt).toLocaleString()}, not live
            </div>
          ) : null}
          <iframe
            key={frameKey}
            src={iframeSrc}
            title="Security lab snapshot"
            className="h-[min(85vh,calc(100vh-12rem))] w-full min-h-[32rem] border-0"
            sandbox=""
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
    </div>
  );
}
