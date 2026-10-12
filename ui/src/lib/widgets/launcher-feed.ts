/**
 * Public JSON for the Omalauncher home-screen tiles.
 * Disk snapshots only. Star lines are omitted unless a cached enrich pass
 * actually found them — never a zero, never a Zapstore install count.
 */
import { nip19 } from "nostr-tools";

import { pickProfileDisplayName } from "../nostr/kind0-profile-fields";
import { platformHintToLabel } from "../nostr/nip82-software";
import { softwareAppHref } from "../seo/software-app-path";
import { canonicalNpubRepoPath } from "../seo/vanity-repo-redirect";
import type { PlatformRecentRepo, RepoStats, UserStats } from "../stats";

export const LAUNCHER_REPO_LIMIT = 15;
export const LAUNCHER_PEOPLE_LIMIT = 15;
export const LAUNCHER_APP_LIMIT = 24;

export const LAUNCHER_LINKS = {
  home: "/",
  explore: "/explore",
  apps: "/apps",
  nostrGit: "/nostr-git",
  help: "/help#launcher-widgets",
  helpApps: "/help#publish-pages-apps",
} as const;

export type LauncherRepoFacts = {
  description?: string | null;
  nostrStars?: number | null;
  githubStars?: number | null;
};

export type LauncherAppFacts = {
  nostrStars?: number | null;
  githubStars?: number | null;
};

export type LauncherAppSource = {
  pubkey: string;
  appId: string;
  name?: string;
  summary?: string;
  repository?: string;
  topics?: string[];
  platformHints?: string[];
  createdAt?: number;
};

export type LauncherFeedRow = {
  name: string;
  desc: string;
  meta: string;
  count: number;
  /** Yellow activity label. Same rounding as the tile, including 1000 → "1k". */
  countLabel: string;
  url: string;
  pubkey: string;
};

export type LauncherAppRow = {
  name: string;
  desc: string;
  meta: string;
  url: string;
  pubkey: string;
  hay: string;
};

export type LauncherFeed = {
  at: number;
  repos: LauncherFeedRow[];
  people: LauncherFeedRow[];
  apps: LauncherAppRow[];
  links: {
    home: string;
    explore: string;
    apps: string;
    nostrGit: string;
    help: string;
    helpApps: string;
  };
};

export function formatWidgetCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const whole = Math.floor(n);
  if (whole < 1000) return String(whole);
  if (whole < 10_000) {
    const s = (whole / 1000).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
  }
  if (whole < 1_000_000) return `${Math.round(whole / 1000)}k`;
  const s = (whole / 1_000_000).toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s}m`;
}

export function cleanWidgetText(
  raw: string | null | undefined,
  max = 180
): string {
  const collapsed = String(raw || "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return "";
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Profile label safe to put in front of "/repo". Empty when it isn't a name. */
export function cleanDisplayName(raw: string | null | undefined): string {
  const stripped = String(raw || "")
    .replace(/\s*\(mirrored user from github\)\s*/gi, " ")
    .replace(/[/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  if (/^npub1/i.test(stripped)) return "";
  if (/^[0-9a-f]{8,64}$/i.test(stripped)) return "";
  if (/^anonymous nostrich$/i.test(stripped)) return "";
  return stripped.slice(0, 28);
}

/** One path segment. A slash in the name would break the gittr URL. */
export function safeRepoName(raw: string | null | undefined): string {
  const name = cleanWidgetText(raw, 80);
  if (!name || /[\\/]/.test(name) || name.includes("..")) return "";
  return name;
}

export function labelFromProfile(
  meta: {
    name?: unknown;
    display_name?: unknown;
    displayName?: unknown;
  } | null
): string {
  return cleanDisplayName(pickProfileDisplayName(meta));
}

export function shortOwnerLabel(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function parseGithubOwnerRepo(
  url: string | null | undefined
): { owner: string; repo: string } | null {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (trimmed.startsWith("git@github.com:")) {
    normalized = `https://github.com/${trimmed.slice(
      "git@github.com:".length
    )}`;
  }
  try {
    const u = new URL(normalized);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length < 2) return null;
    const owner = parts[0] || "";
    const repo = parts[1] || "";
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

export function descriptionFromAnnouncement(event: {
  content?: string;
  tags?: string[][] | null;
}): string {
  const tags = event.tags || [];
  const tag = tags.find((t) => t[0] === "description" && t[1]?.trim());
  let fromContent = "";
  const raw = String(event.content || "").trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { description?: unknown };
      if (typeof parsed.description === "string")
        fromContent = parsed.description;
    } catch {
      /* not JSON */
    }
  } else if (raw && raw.length <= 180) {
    fromContent = raw;
  }
  return cleanWidgetText(fromContent || tag?.[1] || "");
}

export function githubFromAnnouncementTags(
  tags: string[][] | null | undefined
): { owner: string; repo: string } | null {
  const prefer = ["source", "forkedFrom", "clone", "web", "link"];
  for (const kind of prefer) {
    for (const tag of tags || []) {
      if (tag[0] !== kind) continue;
      for (let i = 1; i < tag.length; i++) {
        const parsed = parseGithubOwnerRepo(tag[i]);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

function positiveCount(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function repoStarMeta(facts: LauncherRepoFacts | undefined): string {
  const nostr = positiveCount(facts?.nostrStars);
  const github = positiveCount(facts?.githubStars);
  const parts: string[] = [];
  if (nostr != null) parts.push(`★ ${formatWidgetCount(nostr)} nostr`);
  if (github != null) parts.push(`★ ${formatWidgetCount(github)} github`);
  return parts.join(" · ");
}

function hexPubkey(value: string | null | undefined): string | null {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

function recentBlurb(
  recent: PlatformRecentRepo[] | undefined,
  owner: string,
  repoName: string
): string {
  for (const row of recent || []) {
    if (hexPubkey(row.ownerPubkey) !== owner) continue;
    if (row.repo !== repoName && row.repoName !== repoName) continue;
    const text = cleanWidgetText(row.description);
    if (text && text.toLowerCase() !== repoName.toLowerCase()) return text;
  }
  return "";
}

function ownerTitle(
  owner: string,
  repoName: string,
  names: Record<string, string>
): string {
  const label = cleanDisplayName(names[owner]) || shortOwnerLabel(owner);
  return `${label}/${repoName}`;
}

function absolute(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${
    path.startsWith("/") ? path : `/${path}`
  }`;
}

function appPlatform(app: LauncherAppSource): string {
  const labels: string[] = [];
  for (const hint of app.platformHints || []) {
    const label = platformHintToLabel(hint);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels[0] || "";
}

function appTopic(app: LauncherAppSource, platform: string): string {
  const topic = cleanWidgetText(app.topics?.[0], 28);
  if (!topic) return "";
  if (platform && topic.toLowerCase() === platform.toLowerCase()) return "";
  return topic;
}

export function appMetaLine(
  app: LauncherAppSource,
  facts: LauncherAppFacts | undefined
): string {
  const platform = appPlatform(app);
  const topic = appTopic(app, platform);
  const place = [platform, topic].filter(Boolean).join(" · ");
  const stars = repoStarMeta(facts);
  return [place, stars].filter(Boolean).join(" · ");
}

export function buildLauncherWidgetFeed(input: {
  origin?: string;
  at?: number;
  topRepos?: RepoStats[];
  topUsers?: UserStats[];
  recentRepos?: PlatformRecentRepo[];
  apps?: LauncherAppSource[];
  names?: Record<string, string>;
  repoFacts?: Record<string, LauncherRepoFacts>;
  appFacts?: Record<string, LauncherAppFacts>;
  isBlocked?: (pubkey: string) => boolean;
}): LauncherFeed {
  const origin = (input.origin || "https://gittr.space").replace(/\/$/, "");
  const names = input.names || {};
  const repoFacts = input.repoFacts || {};
  const appFacts = input.appFacts || {};
  const blocked = input.isBlocked || (() => false);

  const repos: LauncherFeedRow[] = [];
  const seenRepos = new Set<string>();
  const rankedRepos = [...(input.topRepos || [])].sort((a, b) => {
    const byCount = (b.activityCount || 0) - (a.activityCount || 0);
    if (byCount !== 0) return byCount;
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });
  for (const repo of rankedRepos) {
    if (repos.length >= LAUNCHER_REPO_LIMIT) break;
    const owner = hexPubkey(repo.entity);
    const repoName = safeRepoName(repo.repoName);
    if (!owner || !repoName || blocked(owner)) continue;
    if ((repo.activityCount || 0) <= 0) continue;
    const key = `${owner}/${repoName.toLowerCase()}`;
    if (seenRepos.has(key)) continue;
    seenRepos.add(key);
    const facts = repoFacts[`${owner}/${repoName}`] || repoFacts[key];
    const desc =
      cleanWidgetText(facts?.description) ||
      recentBlurb(input.recentRepos, owner, repoName);
    let url = origin;
    try {
      url = `${origin}${canonicalNpubRepoPath(owner, repoName)}`;
    } catch {
      url = `${origin}/explore`;
    }
    repos.push({
      name: ownerTitle(owner, repoName, names),
      desc: desc.toLowerCase() === repoName.toLowerCase() ? "" : desc,
      meta: repoStarMeta(facts),
      count: Math.floor(repo.activityCount || 0),
      countLabel: formatWidgetCount(repo.activityCount || 0),
      url,
      pubkey: owner,
    });
  }

  const people: LauncherFeedRow[] = [];
  const rankedUsers = [...(input.topUsers || [])].sort(
    (a, b) => (b.activityCount || 0) - (a.activityCount || 0)
  );
  for (const user of rankedUsers) {
    if (people.length >= LAUNCHER_PEOPLE_LIMIT) break;
    const pubkey = hexPubkey(user.pubkey);
    if (!pubkey || blocked(pubkey)) continue;
    if ((user.activityCount || 0) <= 0) continue;
    if (
      (user.reposCreatedCount || 0) === 0 &&
      (user.commitCount || 0) === 0 &&
      (user.prMergedCount || 0) === 0 &&
      (user.activityCount || 0) >= 20
    ) {
      continue;
    }
    const reposCreated = Math.max(0, Math.floor(user.reposCreatedCount || 0));
    let profile = origin;
    try {
      profile = `${origin}/${nip19.npubEncode(pubkey)}`;
    } catch {
      profile = `${origin}/explore`;
    }
    people.push({
      name: cleanDisplayName(names[pubkey]) || shortOwnerLabel(pubkey),
      desc: reposCreated
        ? `${reposCreated} ${reposCreated === 1 ? "repo" : "repos"}`
        : "",
      meta: "",
      count: Math.floor(user.activityCount || 0),
      countLabel: formatWidgetCount(user.activityCount || 0),
      url: profile,
      pubkey,
    });
  }

  const apps: LauncherAppRow[] = [];
  const seenApps = new Set<string>();
  const rankedApps = [...(input.apps || [])].sort((a, b) => {
    const byTime = (b.createdAt || 0) - (a.createdAt || 0);
    if (byTime !== 0) return byTime;
    return (a.name || "").localeCompare(b.name || "");
  });
  for (const app of rankedApps) {
    if (apps.length >= LAUNCHER_APP_LIMIT) break;
    const pubkey = hexPubkey(app.pubkey);
    const appId = cleanWidgetText(app.appId, 120);
    if (!pubkey || !appId || blocked(pubkey)) continue;
    if (
      appId.toLowerCase() === "mine" ||
      /[\\/]/.test(appId) ||
      appId.includes("..")
    ) {
      continue;
    }
    const dedupe = appId.toLowerCase();
    if (seenApps.has(dedupe)) continue;
    seenApps.add(dedupe);
    const name = cleanWidgetText(app.name, 80) || appId;
    const desc = cleanWidgetText(app.summary);
    const facts = appFacts[appId] || appFacts[dedupe];
    const meta = appMetaLine(app, facts);
    const hay = [name, desc, meta, appId, app.repository || ""]
      .join(" ")
      .toLowerCase();
    apps.push({
      name,
      desc: desc.toLowerCase() === name.toLowerCase() ? "" : desc,
      meta,
      url: softwareAppHref(origin, appId),
      pubkey,
      hay,
    });
  }

  const links = {
    home: absolute(origin, LAUNCHER_LINKS.home),
    explore: absolute(origin, LAUNCHER_LINKS.explore),
    apps: absolute(origin, LAUNCHER_LINKS.apps),
    nostrGit: absolute(origin, LAUNCHER_LINKS.nostrGit),
    help: absolute(origin, LAUNCHER_LINKS.help),
    helpApps: absolute(origin, LAUNCHER_LINKS.helpApps),
  };

  return {
    at: input.at || 0,
    repos,
    people,
    apps,
    links,
  };
}
