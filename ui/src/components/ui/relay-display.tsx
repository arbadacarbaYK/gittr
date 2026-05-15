"use client";

import { useEffect, useState } from "react";

import { isGraspServer } from "@/lib/utils/grasp-servers";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Server,
  XCircle,
} from "lucide-react";

interface GitSourceStatus {
  source: string;
  status: "pending" | "fetching" | "success" | "failed";
  error?: string;
  displayName?: string;
}

interface RelayDisplayProps {
  relays: string[];
  graspServers?: string[];
  userRelays?: string[]; // User-configured relays (added via addRelay or currently connected)
  gitSourceStatuses?: GitSourceStatus[]; // Status of git source fetches (GitHub, GitLab, Codeberg, etc.)
  cloneUrls?: string[]; // Clone URLs from NIP-34 event
  className?: string;
}

/**
 * Displays configured Nostr relays and Grasp servers
 * Similar to gitworkshop.dev's relay/grasp server display
 * Sections are collapsible to save space
 * Also displays git source fetch statuses (GitHub, GitLab, Codeberg, etc.)
 */
export function RelayDisplay({
  relays,
  graspServers,
  userRelays = [],
  gitSourceStatuses = [],
  cloneUrls = [],
  className = "",
}: RelayDisplayProps) {
  const [mounted, setMounted] = useState(false);
  const [graspExpanded, setGraspExpanded] = useState(false);
  const [relaysExpanded, setRelaysExpanded] = useState(false);
  const [gitSourcesExpanded, setGitSourcesExpanded] = useState(true); // Expanded by default to show fetch progress

  useEffect(() => {
    setMounted(true);
  }, []);

  // Combine default relays with user-configured relays
  // User relays take precedence (they're added/configured by the user)
  const allRelays = [
    ...relays,
    ...userRelays.filter((r) => !relays.includes(r)), // Add user relays not already in default list
  ];

  const graspHttpsFromCloneUrls: string[] = [];
  for (const url of cloneUrls) {
    const u = String(url || "").trim();
    if (
      !u ||
      (!u.startsWith("http://") && !u.startsWith("https://")) ||
      u.includes("localhost") ||
      u.includes("127.0.0.1")
    ) {
      continue;
    }
    if (!isGraspServer(u)) continue;
    if (!graspHttpsFromCloneUrls.includes(u)) graspHttpsFromCloneUrls.push(u);
  }

  // GRASP-capable wss endpoints (same host often runs relay + git)
  const graspFromRelays = allRelays.filter(isGraspServer);

  /** Same GRASP host is often listed twice: full https clone URL + wss relay URL — dedupe by host. */
  const graspCanonicalHost = (url: string): string => {
    let rest = String(url || "").trim();
    if (!rest) return "";
    if (/^wss?:\/\//i.test(rest)) rest = rest.replace(/^wss?:\/\//i, "");
    else if (/^https?:\/\//i.test(rest))
      rest = rest.replace(/^https?:\/\//i, "");
    else if (rest.startsWith("git@")) rest = rest.slice(4);
    const hostPart = rest.split("/")[0] ?? "";
    return (hostPart.split(":")[0] ?? "").toLowerCase();
  };
  const graspRepresentativeScore = (u: string): number => {
    if (/^https:\/\//i.test(u) && /\/[^/]+\//.test(u)) return 4;
    if (/^http:\/\//i.test(u) && /\/[^/]+\//.test(u)) return 3;
    if (/^https:\/\//i.test(u)) return 2;
    if (/^wss?:\/\//i.test(u)) return 1;
    return 0;
  };
  const graspByHost = new Map<string, string>();
  const addGraspCandidate = (u: string) => {
    const t = String(u || "").trim();
    if (!t || !isGraspServer(t)) return;
    const host = graspCanonicalHost(t);
    if (!host) return;
    const prev = graspByHost.get(host);
    if (!prev || graspRepresentativeScore(t) > graspRepresentativeScore(prev)) {
      graspByHost.set(host, t);
    }
  };
  for (const u of graspServers || []) addGraspCandidate(u);
  for (const u of graspHttpsFromCloneUrls) addGraspCandidate(u);
  for (const u of graspFromRelays) addGraspCandidate(u);

  const allGraspServers = Array.from(graspByHost.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);

  // Full relay list from the repo announcement + connected relays (do not hide GRASP relays;
  // they may be the only relays on the event, and users still need to see them).
  const regularRelays = allRelays.filter((v, i, self) => self.indexOf(v) === i);

  // Get status icon and color for git sources
  const getGitSourceStatusIcon = (status: GitSourceStatus["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="h-3 w-3 shrink-0 text-gray-500" />;
      case "fetching":
        return (
          <Loader2 className="h-3 w-3 shrink-0 text-blue-400 animate-spin" />
        );
      case "success":
        return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />;
      case "failed":
        return <XCircle className="h-3 w-3 shrink-0 text-red-400" />;
      default:
        return <Clock className="h-3 w-3 shrink-0 text-gray-500" />;
    }
  };

  const getGitSourceStatusColor = (status: GitSourceStatus["status"]) => {
    switch (status) {
      case "pending":
        return "text-gray-400 bg-gray-500/10 border-gray-500/20";
      case "fetching":
        return "text-blue-400 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20";
      case "success":
        return "text-green-400 bg-green-500/10 border-green-500/20";
      case "failed":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      default:
        return "text-gray-400 bg-gray-500/10 border-gray-500/20";
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Git Sources Section - shows fetch status for GitHub, GitLab, Codeberg, etc. */}
      {gitSourceStatuses.length > 0 && (
        <div>
          <button
            onClick={() => setGitSourcesExpanded(!gitSourcesExpanded)}
            className="flex items-center gap-2 w-full mb-2 font-bold text-sm text-gray-300 hover:text-gray-200 transition-colors"
          >
            {gitSourcesExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Git Sources</span>
            <span
              className="text-xs text-gray-500 ml-auto"
              suppressHydrationWarning
            >
              ({mounted ? gitSourceStatuses.length : "…"})
            </span>
          </button>
          {gitSourcesExpanded && (
            <div className="space-y-1 ml-6">
              {gitSourceStatuses.map((gitStatus, idx) => {
                const displayName =
                  gitStatus.displayName ||
                  gitStatus.source
                    .replace(/^https?:\/\//, "")
                    .replace(/\.git$/, "")
                    .split("/")
                    .slice(0, 2)
                    .join("/");
                const domain = gitStatus.source
                  .replace(/^https?:\/\//, "")
                  .replace(/^git:\/\//, "")
                  .split("/")[0];
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 text-xs px-2 py-1 rounded border transition-colors ${getGitSourceStatusColor(
                      gitStatus.status
                    )}`}
                    title={
                      gitStatus.error
                        ? `Error: ${gitStatus.error}`
                        : gitStatus.source
                    }
                  >
                    {getGitSourceStatusIcon(gitStatus.status)}
                    <span className="truncate flex-1">{displayName}</span>
                    {gitStatus.status === "fetching" && (
                      <span className="text-xs text-blue-300">fetching...</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Grasp Servers Section */}
      {allGraspServers.length > 0 && (
        <div>
          <button
            onClick={() => setGraspExpanded(!graspExpanded)}
            className="flex items-center gap-2 w-full mb-2 font-bold text-sm text-gray-300 hover:text-gray-200 transition-colors"
          >
            {graspExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Grasp Servers</span>
            <span
              className="text-xs text-gray-500 ml-auto"
              suppressHydrationWarning
            >
              ({mounted ? allGraspServers.length : "…"})
            </span>
          </button>
          {graspExpanded && (
            <div className="space-y-1 ml-6">
              {allGraspServers.map((server) => {
                const domain = graspCanonicalHost(server);
                return (
                  <a
                    key={domain}
                    href={
                      server.startsWith("http") ? server : `https://${domain}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 transition-colors bg-purple-500/10 hover:bg-purple-500/20 px-2 py-1 rounded border border-purple-500/20"
                    title={server}
                  >
                    <Server className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1">{domain}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Relays Section */}
      {regularRelays.length > 0 && (
        <div>
          <button
            onClick={() => setRelaysExpanded(!relaysExpanded)}
            className="flex items-center gap-2 w-full mb-2 font-bold text-sm text-gray-300 hover:text-gray-200 transition-colors"
          >
            {relaysExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Relays</span>
            <span className="text-xs text-gray-500 ml-auto">
              ({regularRelays.length})
            </span>
          </button>
          {relaysExpanded && (
            <div className="space-y-1 ml-6">
              {regularRelays.map((relay, idx) => {
                // Extract domain from URL
                const domain = relay.replace(/^wss?:\/\//, "").split("/")[0];
                return (
                  <a
                    key={idx}
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 transition-colors bg-purple-500/10 hover:bg-purple-500/20 px-2 py-1 rounded border border-purple-500/20"
                    title={relay}
                  >
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1">{domain}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
