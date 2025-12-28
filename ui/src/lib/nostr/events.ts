// Nostr event types and utilities for repositories, issues, PRs
import { getEventHash, signEvent, nip19, getPublicKey } from "nostr-tools";

// Event kinds (from gitnostr protocol + custom for issues/PRs)
export const KIND_REPOSITORY = 51; // gitnostr protocol
export const KIND_REPOSITORY_NIP34 = 30617; // NIP-34: Repository announcements
export const KIND_REPOSITORY_STATE = 30618; // NIP-34: Repository state (refs, branches, commits) - required by ngit clients
export const KIND_REPOSITORY_PERMISSION = 50; // gitnostr protocol
export const KIND_SSH_KEY = 52; // gitnostr protocol
export const KIND_ISSUE = 1621; // NIP-34: Issues
export const KIND_PULL_REQUEST = 1618; // NIP-34: Pull Requests
export const KIND_PR_UPDATE = 1619; // NIP-34: Pull Request Updates
export const KIND_STATUS_OPEN = 1630; // NIP-34: Status - Open
export const KIND_STATUS_APPLIED = 1631; // NIP-34: Status - Applied/Merged (PRs) or Resolved (Issues)
export const KIND_STATUS_CLOSED = 1632; // NIP-34: Status - Closed
export const KIND_STATUS_DRAFT = 1633; // NIP-34: Status - Draft
export const KIND_DISCUSSION = 9805; // Custom: Discussions
export const KIND_BOUNTY = 9806; // Custom: Bounties
export const KIND_COMMENT = 1; // NIP-01: Notes (for comments)
export const KIND_REACTION = 7; // NIP-25: Reactions
export const KIND_ZAP = 9735; // NIP-57: Zaps
export const KIND_DELETION = 5; // NIP-09: Deletion/Revocation events
export const KIND_CODE_SNIPPET = 1337; // NIP-C0: Code snippets

export interface RepositoryEvent {
  repositoryName: string;
  name?: string; // NIP-34: Human-readable project name (for "name" tag)
  publicRead: boolean;
  publicWrite: boolean;
  gitSshBase?: string;
  description?: string;
  tags?: string[];
  zapPolicy?: {
    splits: Array<{ pubkey: string; weight: number }>;
  };
  // GRASP protocol: clone and relays tags
  clone?: string[]; // Array of git server URLs (e.g., ["https://gittr.space", "https://relay.ngit.dev"])
  relays?: string[]; // Array of Nostr relay URLs (e.g., ["wss://relay.noderunners.network", "wss://gitnostr.com"])
  // Extended metadata for full repo info
  sourceUrl?: string;
  forkedFrom?: string;
  readme?: string;
  files?: Array<{type: string; path: string; size?: number}>;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  topics?: string[];
  contributors?: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string}>;
  defaultBranch?: string;
  branches?: Array<{name: string; commit?: string}>;
  // TODO: Extend releases to include asset URLs from Blossom (NIP-96) uploads
  // Current: Only metadata (tag, name, description, createdAt)
  // Planned: Add assets array with Blossom URLs, optional payment requirements
  releases?: Array<{tag: string; name: string; description?: string; createdAt?: number}>;
  logoUrl?: string;
  requiredApprovals?: number;
  // Deletion marker - if true, owner has marked this repo as deleted on Nostr
  deleted?: boolean;
  archived?: boolean; // Alternative to deleted - marks repo as archived but not deleted
  // Repository links (docs, social media, Discord/Slack, YouTube, etc.)
  links?: Array<{
    type: "docs" | "discord" | "slack" | "youtube" | "twitter" | "github" | "other";
    url: string;
    label?: string;
  }>;
}

export interface IssueEvent {
  repoEntity: string; // Owner entity (npub or pubkey)
  repoName: string; // Repository identifier (matches "d" tag in announcement)
  ownerPubkey: string; // Full 64-char hex pubkey of repository owner (for "a" tag)
  earliestUniqueCommit?: string; // Earliest unique commit ID (for "r" tag)
  title: string;
  description: string; // Description text (will be used as markdown content in NIP-34 event)
  labels?: string[];
  assignees?: string[];
  status: "open" | "closed"; // Note: Status should be set via separate status events (kinds 1630-1632)
  // Bounties, code snippets, etc. are handled via separate events, not in issue content
  projectId?: string;
  milestoneId?: string;
}

export interface DiscussionEvent {
  repoEntity: string;
  repoName: string;
  title: string;
  description: string;
  category?: string;
  status?: "open" | "closed";
}

export interface PullRequestEvent {
  repoEntity: string; // Owner entity (npub or pubkey)
  repoName: string; // Repository identifier (matches "d" tag in announcement)
  ownerPubkey: string; // Full 64-char hex pubkey of repository owner (for "a" tag)
  earliestUniqueCommit?: string; // Earliest unique commit ID (for "r" tag)
  title: string;
  description: string; // Description text (will be used as markdown content in NIP-34 event)
  baseBranch: string;
  headBranch?: string;
  currentCommitId?: string; // Tip of PR branch (for "c" tag) - REQUIRED
  cloneUrls?: string[]; // At least one git clone URL (for "clone" tag) - REQUIRED
  branchName?: string; // Recommended branch name (for "branch-name" tag)
  mergeBase?: string; // Most recent common ancestor with target branch (for "merge-base" tag)
  rootPatchEventId?: string; // If PR is revision of existing patch (for "e" tag)
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  status: "open" | "merged" | "closed"; // Note: Status should be set via separate status events (kinds 1630-1632)
  linkedIssue?: string; // Event ID of linked issue
  // changedFiles, etc. are handled via separate events or custom tags, not in PR content
}

export interface CommentEvent {
  replyTo?: string; // Event ID (NIP-10)
  repoEntity?: string;
  repoName?: string;
  issueId?: string;
  prId?: string;
  content: string;
}

export interface BountyEvent {
  issueId: string; // Event ID or local ID of the issue
  repoEntity: string;
  repoName: string;
  amount: number; // sats
  status: "pending" | "paid" | "released" | "claimed";
  // LNURL-withdraw system (new)
  withdrawId?: string;
  lnurl?: string;
  withdrawUrl?: string;
  // Legacy invoice system (for backwards compatibility)
  invoice?: string;
  paymentHash?: string;
  // Metadata
  creator: string; // Pubkey of bounty creator
  createdAt?: number;
  releasedAt?: number;
  claimedAt?: number;
  claimedBy?: string; // Pubkey of PR author who claimed
}

export interface SSHKeyEvent {
  publicKey: string; // Format: "<key-type> <base64-key> <title>"
  title?: string;
}

export interface CodeSnippetEvent {
  content: string; // The actual code
  language?: string; // From 'l' tag (lowercase, e.g., "javascript", "python")
  extension?: string; // From 'extension' tag (without dot, e.g., "js", "py")
  name?: string; // From 'name' tag (commonly a filename, e.g., "hello-world.js")
  description?: string; // From 'description' tag
  runtime?: string; // From 'runtime' tag (e.g., "node v18.15.0", "python 3.11")
  license?: string[]; // From 'license' tags (SPDX identifiers, can be multiple)
  dependencies?: string[]; // From 'dep' tags (can be repeated)
  repo?: string; // From 'repo' tag (URL or NIP-34 format: "30617:<pubkey>:<d tag>")
  repoRelay?: string; // Recommended relay for repo event (additional parameter on 'repo' tag)
}

// Create and sign a Nostr repository event
export function createRepositoryEvent(
  repo: RepositoryEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34: Build tags array with all required metadata
  const tags: string[][] = [
    ["d", repo.repositoryName], // Replaceable event identifier (NIP-34 required)
  ];
  
  // NIP-34: Add name tag (human-readable project name)
  // CRITICAL: Always include "name" tag for discoverability by other clients
  // Use repo.name if available, otherwise fallback to repositoryName
  const repoName = (repo as any).name || repo.repositoryName;
  if (repoName) {
    tags.push(["name", repoName]);
  }
  
  // NIP-34: Add description tag
  // CRITICAL: Always include "description" tag (other clients expect it)
  const description = repo.description || `Repository: ${repoName || repo.repositoryName}`;
  if (description) {
    tags.push(["description", description]);
  }
  
  // GRASP-01 / NIP-34: Add clone tags (git server URLs)
  // CRITICAL: At least one clone tag is required for NIP-34 compliance
  // Other clients need clone URLs to access the repository
  if (repo.clone && repo.clone.length > 0) {
    repo.clone.forEach(url => {
      if (url && typeof url === "string" && url.trim().length > 0) {
        tags.push(["clone", url.trim()]);
      }
    });
  }
  
  // If no clone URLs provided, this is a warning but we'll still create the event
  // (Some clients might handle repos without clone URLs differently)
  
  // GRASP-01 / NIP-34: Add relays tags (Nostr relay URLs)
  // CRITICAL: Per NIP-34 spec, each relay should be in a separate tag
  // Format: ["relays", "wss://relay1.com"], ["relays", "wss://relay2.com"], etc.
  if (repo.relays && repo.relays.length > 0) {
    repo.relays.forEach(relay => {
      // Ensure relay has wss:// prefix
      const normalizedRelay = relay.startsWith("wss://") || relay.startsWith("ws://") 
        ? relay 
        : `wss://${relay}`;
      tags.push(["relays", normalizedRelay]);
    });
  }
  
  // NIP-34: Add topics/tags
  if (repo.tags && repo.tags.length > 0) {
    repo.tags.forEach(tag => {
      tags.push(["t", tag]);
    });
  }
  
  // NIP-34: Add web tags (from logoUrl or links array)
  if (repo.logoUrl && (repo.logoUrl.startsWith("http://") || repo.logoUrl.startsWith("https://"))) {
    tags.push(["web", repo.logoUrl]);
  }
  if (repo.links && Array.isArray(repo.links)) {
    repo.links.forEach(link => {
      if (link.url && (link.url.startsWith("http://") || link.url.startsWith("https://"))) {
        tags.push(["web", link.url]);
      }
    });
  }
  
  // NIP-34: Add maintainers tags (from contributors + owner)
  // CRITICAL: Always include event publisher (owner) as maintainer for discoverability
  const maintainerPubkeys = new Set<string>();
  
  // Add event publisher (owner) as maintainer
  if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
    maintainerPubkeys.add(pubkey);
  }
  
  // Add contributors as maintainers
  if (repo.contributors && Array.isArray(repo.contributors)) {
    repo.contributors.forEach(contributor => {
      const contributorPubkey = contributor.pubkey;
      // Only add if pubkey is valid (64 hex chars)
      if (contributorPubkey && /^[0-9a-f]{64}$/i.test(contributorPubkey)) {
        maintainerPubkeys.add(contributorPubkey);
      }
    });
  }
  
  // Add all maintainers to tags
  // NIP-34: Use npub format per best practices (consistent with push-repo-to-nostr.ts)
  maintainerPubkeys.forEach(maintainerPubkey => {
    try {
      const npub = nip19.npubEncode(maintainerPubkey);
      tags.push(["maintainers", npub]);
    } catch (e) {
      // Fallback to hex if encoding fails (shouldn't happen with valid pubkeys)
      console.warn(`⚠️ [createRepositoryEvent] Failed to encode pubkey to npub, using hex:`, e);
    tags.push(["maintainers", maintainerPubkey]);
    }
  });
  
  // NIP-34: Add "r" tag with "euc" marker for earliest unique commit (optional but recommended)
  // This helps identify repos among forks and group related repos
  // Note: We don't have commit history in RepositoryEvent interface, so this is skipped
  // It can be added in push-repo-to-nostr.ts where we have access to commits
  
  // NIP-34: Add source and forkedFrom tags if present
  if (repo.sourceUrl) {
    tags.push(["source", repo.sourceUrl]);
  }
  if (repo.forkedFrom) {
    tags.push(["forkedFrom", repo.forkedFrom]);
  }
  
  // NIP-34: Add link tags if present
  if (repo.links && Array.isArray(repo.links)) {
    repo.links.forEach(link => {
      if (link.url && typeof link.url === "string" && link.url.trim().length > 0) {
        const linkType = (link.type || "other").toString();
        const linkTag: string[] = ["link", linkType, link.url.trim()];
        if (link.label && typeof link.label === "string" && link.label.trim().length > 0) {
          linkTag.push(link.label.trim());
        }
        tags.push(linkTag);
      }
    });
  }
  
  // Add privacy tags (not in NIP-34 spec, but needed for bridge compatibility and other clients)
  // Bridge uses these to determine access control
  tags.push(["public-read", repo.publicRead !== false ? "true" : "false"]);
  tags.push(["public-write", repo.publicWrite === true ? "true" : "false"]);
  
  // NIP-34: Content field MUST be empty per spec
  // All metadata goes in tags, not in content
  // Bridge compatibility: Metadata is sent to bridge via /api/nostr/repo/event endpoint separately
  const event = {
    kind: KIND_REPOSITORY_NIP34, // NIP-34: Use kind 30617 instead of 51
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "", // NIP-34: Content MUST be empty - all metadata in tags
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

export function createCodeSnippetEvent(
  snippet: CodeSnippetEvent,
  pubkey: string, // Changed: accept pubkey directly instead of deriving from privateKey
  privateKey?: string // Optional: only needed if signing with private key
): any {
  const tags: string[][] = [];
  
  // NIP-C0: Add language tag (lowercase)
  if (snippet.language) {
    tags.push(["l", snippet.language.toLowerCase()]);
  }
  
  // NIP-C0: Add extension tag (without dot)
  if (snippet.extension) {
    tags.push(["extension", snippet.extension.replace(/^\./, "")]);
  }
  
  // NIP-C0: Add name tag (filename)
  if (snippet.name) {
    tags.push(["name", snippet.name]);
  }
  
  // NIP-C0: Add description tag
  if (snippet.description) {
    tags.push(["description", snippet.description]);
  }
  
  // NIP-C0: Add runtime tag
  if (snippet.runtime) {
    tags.push(["runtime", snippet.runtime]);
  }
  
  // NIP-C0: Add license tags (can be multiple)
  if (snippet.license && snippet.license.length > 0) {
    snippet.license.forEach(license => {
      tags.push(["license", license]);
    });
  }
  
  // NIP-C0: Add dependency tags (can be repeated)
  if (snippet.dependencies && snippet.dependencies.length > 0) {
    snippet.dependencies.forEach(dep => {
      tags.push(["dep", dep]);
    });
  }
  
  // NIP-C0: Add repo tag (URL or NIP-34 format: "30617:<pubkey>:<d tag>")
  if (snippet.repo) {
    if (snippet.repoRelay) {
      // Add relay as additional parameter
      tags.push(["repo", snippet.repo, snippet.repoRelay]);
    } else {
      tags.push(["repo", snippet.repo]);
    }
  }
  
  const event = {
    kind: KIND_CODE_SNIPPET,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: snippet.content, // NIP-C0: content contains the actual code
    pubkey,
    id: "",
    sig: "",
  };
  
  event.id = getEventHash(event);
  
  // Only sign if privateKey is provided (for non-NIP-07 signing)
  if (privateKey) {
    event.sig = signEvent(event, privateKey);
  }
  
  return event;
}

// Create and sign a Nostr repository state event (kind 30618)
// Per NIP-34: https://nips.nostr.com/34#repository-state-announcements
// This contains repository refs, branches, and commits - required by ngit clients like gitworkshop.dev
export function createRepositoryStateEvent(
  repositoryName: string,
  refs: Array<{ ref: string; commit: string }>, // e.g., [{ ref: "refs/heads/main", commit: "abc123..." }]
  privateKey: string,
  defaultBranchRef: string | null = null // Optional: default branch ref (e.g., "refs/heads/main") for HEAD tag
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34 state event: Build tags array
  // Per NIP-34 spec: tags are ["refs/heads/main", "commit-id"] format
  // The ref path itself is the tag name, commit-id is the tag value
  const tags: string[][] = [
    ["d", repositoryName], // Replaceable event identifier (NIP-34 required) - matches repo-id from announcement
  ];
  
  // Add refs as tags per NIP-34 spec
  // Format: ["refs/heads/main", "abc123..."] where ref path is tag name, commit-id is tag value
  // Include refs even without commits (bridge will update them later)
  refs.forEach(ref => {
    if (ref.ref && typeof ref.ref === "string") {
      tags.push([ref.ref, ref.commit || ""]); // NIP-34: ref path is tag name, commit is value
    }
  });
  
  // Add HEAD tag pointing to default branch (NIP-34 requirement)
  // Format: ["HEAD", "ref: refs/heads/<branch-name>"]
  // Use provided defaultBranchRef if available, otherwise extract from first refs/heads/ ref
  let defaultBranchName: string | null = null;
  if (defaultBranchRef && typeof defaultBranchRef === "string" && defaultBranchRef.startsWith("refs/heads/")) {
    defaultBranchName = defaultBranchRef.replace("refs/heads/", "");
  } else if (refs.length > 0) {
    // Fallback: use first refs/heads/ ref as default
    const firstHeadRef = refs.find(r => r.ref && typeof r.ref === "string" && r.ref.startsWith("refs/heads/"));
    if (firstHeadRef && firstHeadRef.ref) {
      defaultBranchName = firstHeadRef.ref.replace("refs/heads/", "");
    }
  }
  
  // HEAD tag is required per NIP-34 - always include it
  if (defaultBranchName) {
    tags.push(["HEAD", `ref: refs/heads/${defaultBranchName}`]);
  } else {
    // Last resort: use "main" as default (NIP-34 requires HEAD tag)
    tags.push(["HEAD", "ref: refs/heads/main"]);
  }
  
  // State event content is empty per NIP-34 spec
  const content = "";
  
  const event = {
    kind: KIND_REPOSITORY_STATE, // NIP-34: Use kind 30618 for state events
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content, // NIP-34: content is empty
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

// Create and sign a Nostr issue event (NIP-34 kind 1621)
// Per NIP-34: https://nips.nostr.com/34#issues
export function createIssueEvent(
  issue: IssueEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34 required tags
  const tags: string[][] = [
    // ["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"] - REQUIRED
    ["a", `30617:${issue.ownerPubkey}:${issue.repoName}`],
    // ["r", "<earliest-unique-commit-id-of-repo>"] - REQUIRED (helps clients subscribe to all issues for a repo)
    ...(issue.earliestUniqueCommit ? [["r", issue.earliestUniqueCommit]] : []),
    // ["p", "<repository-owner>"] - REQUIRED
    ["p", issue.ownerPubkey],
    // ["subject", "<issue-subject>"] - REQUIRED
    ["subject", issue.title],
  ];
  
  // Optional tags
  if (issue.labels && issue.labels.length > 0) {
    issue.labels.forEach(label => tags.push(["t", label]));
  }
  
  // Note: assignees, projectId, milestoneId are custom extensions - not in NIP-34 spec
  // We'll keep them for backward compatibility but they're not standard
  if (issue.assignees && issue.assignees.length > 0) {
    issue.assignees.forEach(assignee => tags.push(["p", assignee, "assignee"]));
  }
  
  if (issue.projectId) {
    tags.push(["project", issue.projectId]);
  }
  
  if (issue.milestoneId) {
    tags.push(["milestone", issue.milestoneId]);
  }

  // NIP-34: Content is markdown text, not JSON
  const event = {
    kind: KIND_ISSUE, // NIP-34: kind 1621
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: issue.description, // Markdown text per NIP-34
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}


// Create and sign a Nostr pull request event (NIP-34 kind 1618)
// Per NIP-34: https://nips.nostr.com/34#pull-requests
export function createPullRequestEvent(
  pr: PullRequestEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34 required tags
  const tags: string[][] = [
    // ["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"] - REQUIRED
    ["a", `30617:${pr.ownerPubkey}:${pr.repoName}`],
    // ["r", "<earliest-unique-commit-id-of-repo>"] - REQUIRED (helps clients subscribe to all PRs for a repo)
    ...(pr.earliestUniqueCommit ? [["r", pr.earliestUniqueCommit]] : []),
    // ["p", "<repository-owner>"] - REQUIRED
    ["p", pr.ownerPubkey],
    // ["subject", "<PR-subject>"] - REQUIRED
    ["subject", pr.title],
    // ["c", "<current-commit-id>"] - REQUIRED (tip of the PR branch)
    ...(pr.currentCommitId ? [["c", pr.currentCommitId]] : []),
    // ["clone", "<clone-url>", ...] - REQUIRED (at least one git clone URL where commit can be downloaded)
    ...(pr.cloneUrls && pr.cloneUrls.length > 0 ? pr.cloneUrls.map(url => ["clone", url]) : []),
  ];
  
  // Optional tags
  if (pr.branchName) {
    tags.push(["branch-name", pr.branchName]);
  }
  
  if (pr.mergeBase) {
    tags.push(["merge-base", pr.mergeBase]);
  }
  
  if (pr.rootPatchEventId) {
    // If PR is a revision of an existing patch
    tags.push(["e", pr.rootPatchEventId, "", "root"]);
  }
  
  if (pr.labels && pr.labels.length > 0) {
    pr.labels.forEach(label => tags.push(["t", label]));
  }
  
  // Note: assignees, reviewers, linkedIssue are custom extensions - not in NIP-34 spec
  // We'll keep them for backward compatibility but they're not standard
  if (pr.assignees && pr.assignees.length > 0) {
    pr.assignees.forEach(assignee => tags.push(["p", assignee, "assignee"]));
  }
  
  if (pr.reviewers && pr.reviewers.length > 0) {
    pr.reviewers.forEach(reviewer => tags.push(["p", reviewer, "reviewer"]));
  }
  
  if (pr.linkedIssue) {
    tags.push(["e", pr.linkedIssue, "", "linked"]);
  }

  // NIP-34: Content is markdown text, not JSON
  const event = {
    kind: KIND_PULL_REQUEST, // NIP-34: kind 1618
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: pr.description, // Markdown text per NIP-34
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

// Create and sign a Nostr pull request update event (NIP-34 kind 1619)
// Per NIP-34: https://nips.nostr.com/34#pull-request-updates
export function createPullRequestUpdateEvent(
  prUpdate: {
    ownerPubkey: string; // Repository owner pubkey
    repoName: string; // Repository identifier
    earliestUniqueCommit?: string; // Earliest unique commit ID
    pullRequestEventId: string; // Event ID of the PR being updated
    pullRequestAuthor: string; // Pubkey of PR author
    currentCommitId: string; // Updated tip of PR branch
    cloneUrls: string[]; // At least one git clone URL
    mergeBase?: string; // Most recent common ancestor with target branch
  },
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34 required tags
  const tags: string[][] = [
    // ["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"] - REQUIRED
    ["a", `30617:${prUpdate.ownerPubkey}:${prUpdate.repoName}`],
    // ["r", "<earliest-unique-commit-id-of-repo>"] - REQUIRED
    ...(prUpdate.earliestUniqueCommit ? [["r", prUpdate.earliestUniqueCommit]] : []),
    // ["p", "<repository-owner>"] - REQUIRED
    ["p", prUpdate.ownerPubkey],
    // NIP-22 tags for PR update
    ["E", prUpdate.pullRequestEventId], // PR event ID
    ["P", prUpdate.pullRequestAuthor], // PR author
    // ["c", "<current-commit-id>"] - REQUIRED (updated tip of PR)
    ["c", prUpdate.currentCommitId],
    // ["clone", "<clone-url>", ...] - REQUIRED
    ...prUpdate.cloneUrls.map(url => ["clone", url]),
  ];
  
  // Optional tags
  if (prUpdate.mergeBase) {
    tags.push(["merge-base", prUpdate.mergeBase]);
  }

  // NIP-34: Content is empty string for PR updates
  const event = {
    kind: KIND_PR_UPDATE, // NIP-34: kind 1619
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "", // Empty per NIP-34
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

// Create and sign a Nostr status event (NIP-34 kinds 1630-1633)
// Per NIP-34: https://nips.nostr.com/34#status
export function createStatusEvent(
  status: {
    statusKind: 1630 | 1631 | 1632 | 1633; // Open, Applied/Merged, Closed, Draft
    rootEventId: string; // Issue, PR, or patch event ID
    acceptedRevisionId?: string; // For when revisions are applied (kind 1631)
    ownerPubkey: string; // Repository owner
    rootEventAuthor: string; // Author of root event (issue/PR/patch)
    revisionAuthor?: string; // Author of revision (for kind 1631)
    repoName?: string; // Repository identifier (for optional "a" tag)
    earliestUniqueCommit?: string; // For optional "r" tag
    appliedPatchIds?: Array<{ eventId: string; relayUrl?: string; pubkey: string }>; // For kind 1631
    mergeCommitId?: string; // For kind 1631 when merged
    appliedCommitIds?: string[]; // For kind 1631 when applied as commits
    content?: string; // Markdown text (optional)
  },
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // NIP-34 required tags
  const tags: string[][] = [
    // ["e", "<issue-or-PR-or-original-root-patch-id-hex>", "", "root"] - REQUIRED
    ["e", status.rootEventId, "", "root"],
    // ["p", "<repository-owner>"] - REQUIRED
    ["p", status.ownerPubkey],
    // ["p", "<root-event-author>"] - REQUIRED
    ["p", status.rootEventAuthor],
  ];
  
  // For kind 1631 (Applied/Merged), include accepted revision
  if (status.statusKind === 1631 && status.acceptedRevisionId) {
    tags.push(["e", status.acceptedRevisionId, "", "reply"]);
  }
  
  // Include revision author if provided
  if (status.revisionAuthor) {
    tags.push(["p", status.revisionAuthor]);
  }
  
  // Optional tags for improved subscription filter efficiency
  if (status.repoName) {
    tags.push(["a", `30617:${status.ownerPubkey}:${status.repoName}`]);
  }
  
  if (status.earliestUniqueCommit) {
    tags.push(["r", status.earliestUniqueCommit]);
  }
  
  // For kind 1631 (Applied/Merged)
  if (status.statusKind === 1631) {
    // Applied/merged patch/PR event IDs
    if (status.appliedPatchIds && status.appliedPatchIds.length > 0) {
      status.appliedPatchIds.forEach(({ eventId, relayUrl, pubkey }) => {
        const qTag = ["q", eventId];
        if (relayUrl) qTag.push(relayUrl);
        if (pubkey) qTag.push(pubkey);
        tags.push(qTag);
      });
    }
    
    // Merge commit (when merged)
    if (status.mergeCommitId) {
      tags.push(["merge-commit", status.mergeCommitId]);
      tags.push(["r", status.mergeCommitId]);
    }
    
    // Applied as commits (when applied)
    if (status.appliedCommitIds && status.appliedCommitIds.length > 0) {
      tags.push(["applied-as-commits", ...status.appliedCommitIds]);
      status.appliedCommitIds.forEach(commitId => {
        tags.push(["r", commitId]);
      });
    }
  }

  const event: any = {
    kind: status.statusKind, // NIP-34: 1630, 1631, 1632, or 1633
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: status.content || "", // Markdown text (optional)
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}


// Create and sign a Nostr discussion event
export function createDiscussionEvent(
  discussion: DiscussionEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [
    ["repo", discussion.repoEntity, discussion.repoName],
  ];
  
  if (discussion.category) {
    tags.push(["category", discussion.category]);
  }
  
  if (discussion.status) {
    tags.push(["status", discussion.status]);
  }

  const event = {
    kind: KIND_DISCUSSION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      title: discussion.title,
      description: discussion.description,
      status: discussion.status || "open",
      category: discussion.category,
    }),
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}


// Create and sign a Nostr comment event
export function createCommentEvent(
  comment: CommentEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [];
  
  // Repo context tags
  if (comment.repoEntity && comment.repoName) {
    tags.push(["repo", comment.repoEntity, comment.repoName]);
  }
  
  // NIP-10 threading: 
  // - If replying to an issue/PR, that's the root
  // - If replying to a comment, the issue/PR is root, comment is reply
  if (comment.issueId) {
    // Issue is the root
    tags.push(["e", comment.issueId, "", "root"]);
    
    // If replyTo is set and different from issueId, it's a reply to a comment
    if (comment.replyTo && comment.replyTo !== comment.issueId) {
      tags.push(["e", comment.replyTo, "", "reply"]);
    } else {
      // Direct reply to issue
      tags.push(["e", comment.issueId, "", "reply"]);
    }
  } else if (comment.prId) {
    // PR is the root
    tags.push(["e", comment.prId, "", "root"]);
    
    // If replyTo is set and different from prId, it's a reply to a comment
    if (comment.replyTo && comment.replyTo !== comment.prId) {
      tags.push(["e", comment.replyTo, "", "reply"]);
    } else {
      // Direct reply to PR
      tags.push(["e", comment.prId, "", "reply"]);
    }
  } else if (comment.replyTo) {
    // Fallback: if only replyTo is set, treat as root
    tags.push(["e", comment.replyTo, "", "root"]);
  }
  
  const event = {
    kind: KIND_COMMENT,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: comment.content,
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}


// Create and sign a Nostr bounty event (KIND_BOUNTY = 9806)
export function createBountyEvent(
  bounty: BountyEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [
    ["e", bounty.issueId, "", "issue"], // Reference to issue
    ["repo", bounty.repoEntity, bounty.repoName],
    ["status", bounty.status],
    ["p", bounty.creator, "creator"],
  ];
  
  if (bounty.claimedBy) {
    tags.push(["p", bounty.claimedBy, "claimed_by"]);
  }

  const event = {
    kind: KIND_BOUNTY,
    created_at: Math.floor((bounty.createdAt || Date.now()) / 1000),
    tags,
    content: JSON.stringify({
      amount: bounty.amount,
      status: bounty.status,
      withdrawId: bounty.withdrawId,
      lnurl: bounty.lnurl,
      withdrawUrl: bounty.withdrawUrl,
      invoice: bounty.invoice,
      paymentHash: bounty.paymentHash,
      releasedAt: bounty.releasedAt,
      claimedAt: bounty.claimedAt,
    }),
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}


// Create and sign a Nostr SSH key event (KIND_SSH_KEY = 52)
// Format: content = "<key-type> <base64-public-key> <title>"
// Example: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... My Laptop Key"
export function createSSHKeyEvent(
  sshKey: SSHKeyEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // Validate SSH key format
  const keyParts = sshKey.publicKey.trim().split(/\s+/);
  if (keyParts.length < 2 || !keyParts[0]) {
    throw new Error("Invalid SSH key format. Expected: <key-type> <public-key> [title]");
  }
  
  // Ensure key type is valid
  const keyType = keyParts[0];
  const validKeyTypes = ["ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"];
  if (!validKeyTypes.includes(keyType)) {
    throw new Error(`Invalid key type: ${keyType}. Supported: ${validKeyTypes.join(", ")}`);
  }
  
  // If title is provided and not in key, append it; otherwise use existing title
  let keyContent = sshKey.publicKey.trim();
  const publicKeyData = keyParts[1] || "";
  if (sshKey.title && !keyParts[2]) {
    keyContent = `${keyType} ${publicKeyData} ${sshKey.title}`;
  } else if (!sshKey.title && !keyParts[2]) {
    // Default title if none provided
    keyContent = `${keyType} ${publicKeyData} gittr-${Date.now()}`;
  }
  
  const event = {
    kind: KIND_SSH_KEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [], // No tags required for SSH keys
    content: keyContent,
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

