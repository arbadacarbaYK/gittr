// Nostr event types and utilities for repositories, issues, PRs
import { getEventHash, signEvent, nip19, getPublicKey } from "nostr-tools";

// Event kinds (from gitnostr protocol + custom for issues/PRs)
export const KIND_REPOSITORY = 51; // gitnostr protocol
export const KIND_REPOSITORY_NIP34 = 30617; // NIP-34: Repository announcements
export const KIND_REPOSITORY_PERMISSION = 50; // gitnostr protocol
export const KIND_SSH_KEY = 52; // gitnostr protocol
export const KIND_ISSUE = 9803; // Custom: Issues
export const KIND_PULL_REQUEST = 9804; // Custom: Pull Requests
export const KIND_DISCUSSION = 9805; // Custom: Discussions
export const KIND_BOUNTY = 9806; // Custom: Bounties
export const KIND_COMMENT = 1; // NIP-01: Notes (for comments)
export const KIND_ZAP = 9735; // NIP-57: Zaps
export const KIND_DELETION = 5; // NIP-09: Deletion/Revocation events

export interface RepositoryEvent {
  repositoryName: string;
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
  repoEntity: string;
  repoName: string;
  title: string;
  description: string;
  labels?: string[];
  assignees?: string[];
  status: "open" | "closed";
  bountyAmount?: number; // sats
  bountyInvoice?: string;
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
  repoEntity: string;
  repoName: string;
  title: string;
  description: string;
  baseBranch: string;
  headBranch?: string;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  status: "open" | "merged" | "closed";
  linkedIssue?: string; // Event ID of linked issue
  changedFiles?: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    before?: string;
    after?: string;
  }>;
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

// Create and sign a Nostr repository event
export function createRepositoryEvent(
  repo: RepositoryEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  // GRASP protocol: Add clone and relays tags if provided
  const tags: string[][] = [
    ["d", repo.repositoryName], // Replaceable event identifier
    ...(repo.tags || []).map(tag => ["t", tag]),
  ];
  
  // GRASP-01: Add clone tags (git server URLs)
  if (repo.clone && repo.clone.length > 0) {
    repo.clone.forEach(url => {
      tags.push(["clone", url]);
    });
  }
  
  // GRASP-01: Add relays tags (Nostr relay URLs)
  if (repo.relays && repo.relays.length > 0) {
    repo.relays.forEach(url => {
      tags.push(["relays", url]);
    });
  }
  
  const event = {
    kind: KIND_REPOSITORY,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      repositoryName: repo.repositoryName,
      publicRead: repo.publicRead,
      publicWrite: repo.publicWrite,
      gitSshBase: repo.gitSshBase || "",
      description: repo.description,
      zapPolicy: repo.zapPolicy,
      // Extended metadata
      sourceUrl: repo.sourceUrl,
      forkedFrom: repo.forkedFrom,
      readme: repo.readme,
      files: repo.files,
      stars: repo.stars,
      forks: repo.forks,
      languages: repo.languages,
      topics: repo.topics,
      contributors: repo.contributors,
      defaultBranch: repo.defaultBranch,
      branches: repo.branches,
      releases: repo.releases,
      logoUrl: repo.logoUrl,
      requiredApprovals: repo.requiredApprovals,
      // Deletion markers - if set, owner has marked this repo as deleted/archived
      deleted: repo.deleted,
      archived: repo.archived,
      // Repository links
      links: repo.links,
    }),
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

// Create and sign a Nostr issue event
export function createIssueEvent(
  issue: IssueEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [
    ["repo", issue.repoEntity, issue.repoName],
  ];
  
  if (issue.labels && issue.labels.length > 0) {
    issue.labels.forEach(label => tags.push(["t", label]));
  }
  
  if (issue.assignees && issue.assignees.length > 0) {
    issue.assignees.forEach(assignee => tags.push(["p", assignee]));
  }
  
  if (issue.projectId) {
    tags.push(["project", issue.projectId]);
  }
  
  if (issue.milestoneId) {
    tags.push(["milestone", issue.milestoneId]);
  }

  const event = {
    kind: KIND_ISSUE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      bountyAmount: issue.bountyAmount,
      bountyInvoice: issue.bountyInvoice,
    }),
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}

// Create and sign a Nostr pull request event
export function createPullRequestEvent(
  pr: PullRequestEvent,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [
    ["repo", pr.repoEntity, pr.repoName],
    ["branch", pr.baseBranch, pr.headBranch || pr.baseBranch],
  ];
  
  if (pr.labels && pr.labels.length > 0) {
    pr.labels.forEach(label => tags.push(["t", label]));
  }
  
  if (pr.assignees && pr.assignees.length > 0) {
    pr.assignees.forEach(assignee => tags.push(["p", assignee]));
  }
  
  if (pr.reviewers && pr.reviewers.length > 0) {
    pr.reviewers.forEach(reviewer => tags.push(["p", reviewer, "reviewer"]));
  }
  
  if (pr.linkedIssue) {
    tags.push(["e", pr.linkedIssue, "", "linked"]);
  }

  const event = {
    kind: KIND_PULL_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      title: pr.title,
      description: pr.description,
      status: pr.status,
      changedFiles: pr.changedFiles || [],
    }),
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
