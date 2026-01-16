"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BountyButton } from "@/components/ui/bounty-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NostrUserSearch } from "@/components/ui/nostr-user-search";
import { Textarea } from "@/components/ui/textarea";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_ISSUE,
  KIND_STATUS_OPEN,
  createIssueEvent,
  createStatusEvent,
} from "@/lib/nostr/events";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import {
  formatNotificationMessage,
  sendNotification,
} from "@/lib/notifications";
import { loadStoredRepos } from "@/lib/repos/storage";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import { extractMentionedPubkeys } from "@/lib/utils/mention-detection";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { Check, ChevronDown, Coins, Edit, Settings, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { getEventHash, getPublicKey, signEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";

export default function RepoIssueNewPage() {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const labelsFilterRef = useRef<HTMLInputElement>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const { picture, initials, isLoggedIn, name: userName } = useSession();
  const [filteredLabels, setFilteredLabels] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneeInputValue, setAssigneeInputValue] = useState("");
  const [repoContributors, setRepoContributors] = useState<
    Array<{
      pubkey: string;
      name?: string;
      picture?: string;
      weight?: number;
      role?: string;
    }>
  >([]);
  const [availableProjects, setAvailableProjects] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [availableMilestones, setAvailableMilestones] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(
    null
  );
  // LNURL-withdraw bounty (new system - automatically funded)
  const [bountyWithdrawId, setBountyWithdrawId] = useState<string | null>(null);
  const [bountyLnurl, setBountyLnurl] = useState<string | null>(null);
  const [bountyWithdrawUrl, setBountyWithdrawUrl] = useState<string | null>(
    null
  );
  const [bountyAmount, setBountyAmount] = useState<number>(0);

  // Legacy invoice-based bounty (kept for backwards compatibility)
  const [bountyInvoice, setBountyInvoice] = useState<string | null>(null);
  const [bountyPaymentHash, setBountyPaymentHash] = useState<
    string | undefined
  >(undefined);
  const params = useParams();
  const {
    publish,
    defaultRelays,
    pubkey: currentUserPubkey,
  } = useNostrContext();

  // Fetch metadata for assignees
  const assigneeMetadata = useContributorMetadata(selectedAssignees);

  // Get pubkeys from repo contributors for metadata lookup
  const repoContributorPubkeys = useMemo(() => {
    return repoContributors
      .map((c) => c.pubkey)
      .filter((pubkey) => pubkey && /^[a-f0-9]{64}$/i.test(pubkey));
  }, [repoContributors]);
  const repoContributorMetadata = useContributorMetadata(
    repoContributorPubkeys
  );

  // Load available labels from repo topics
  useEffect(() => {
    try {
      const entity = (params?.entity as string) || "";
      const repo = (params?.repo as string) || "";
      if (!entity || !repo) return;

      const repos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      ) as any[];
      const repoData = repos.find(
        (r: any) => r.entity === entity && r.repo === repo
      );
      if (repoData && repoData.topics) {
        // Use repo topics as available labels
        const labels = repoData.topics
          .filter((t: any) => (typeof t === "string" ? t : t?.name))
          .filter(Boolean);
        setAvailableLabels(labels);
        setFilteredLabels(labels);
      } else {
        setAvailableLabels([]);
        setFilteredLabels([]);
      }

      // Load projects
      try {
        const projectsKey = `gittr_projects_${entity}_${repo}`;
        const projects = JSON.parse(
          localStorage.getItem(projectsKey) || "[]"
        ) as any[];
        setAvailableProjects(
          projects.map((p: any) => ({ id: p.id, name: p.name }))
        );
      } catch {
        setAvailableProjects([]);
      }

      // Load milestones from repo settings (stored in localStorage)
      try {
        const milestonesKey = `gittr_milestones_${entity}_${repo}`;
        const milestones = JSON.parse(
          localStorage.getItem(milestonesKey) || "[]"
        ) as Array<{
          id: string;
          name: string;
          dueDate?: number;
          description?: string;
        }>;
        setAvailableMilestones(
          milestones.map((m: any) => ({ id: m.id, name: m.name }))
        );
      } catch {
        setAvailableMilestones([]);
      }

      // Load repo contributors for assignee dropdown
      if (
        repoData &&
        repoData.contributors &&
        Array.isArray(repoData.contributors)
      ) {
        // Filter to only contributors with valid 64-char pubkeys
        const validContributors = repoData.contributors
          .filter(
            (c: any) =>
              c.pubkey &&
              typeof c.pubkey === "string" &&
              c.pubkey.length === 64 &&
              /^[0-9a-f]{64}$/i.test(c.pubkey)
          )
          .map((c: any) => ({
            pubkey: c.pubkey.toLowerCase(),
            name: c.name,
            picture: c.picture,
            weight: c.weight || 0,
            role: c.role,
          }));
        setRepoContributors(validContributors);
      } else {
        setRepoContributors([]);
      }
    } catch {
      setAvailableLabels([]);
      setFilteredLabels([]);
      setAvailableProjects([]);
      setAvailableMilestones([]);
      setRepoContributors([]);
    }
  }, [params]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (submitting) return;
      setSubmitting(true);
      setErrorMsg("");

      // Check if user is logged in via useSession
      if (!isLoggedIn || !currentUserPubkey) {
        setErrorMsg("Please sign in to create issues.");
        setTimeout(() => {
          setErrorMsg("");
        }, 6000);
        setSubmitting(false);
        return;
      }

      // Check for NIP-07 first, then private key
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      const privateKey = !hasNip07 ? await getNostrPrivateKey() : null;

      // If user is logged in but no signing method, guide them
      if (!hasNip07 && !privateKey) {
        if (!isLoggedIn) {
          setErrorMsg("Please sign in to create issues.");
        } else {
          setErrorMsg(
            "To create issues, you need either: 1) A NIP-07 browser extension (e.g., Alby) installed and enabled, or 2) A private key configured in Settings."
          );
        }
        setTimeout(() => {
          setErrorMsg("");
        }, 8000);
        setSubmitting(false);
        return;
      }

      const entity = params?.entity as string;
      const repo = params?.repo as string;
      const title = titleRef.current?.value || "";
      const description = commentRef.current?.value || "";

      if (!title || !description) {
        setErrorMsg("Title and description are required");
        setSubmitting(false);
        return;
      }

      if (!entity || !repo) {
        setErrorMsg("Invalid repository context");
        setSubmitting(false);
        return;
      }

      try {
        // Get repo data for NIP-34 required fields
        const repos = loadStoredRepos();
        const repoData = findRepoByEntityAndName(repos, entity, repo);
        if (!repoData) {
          setErrorMsg(
            "Repository not found. Please ensure the repository exists."
          );
          setSubmitting(false);
          return;
        }

        // Get owner pubkey (required for NIP-34 "a" and "p" tags)
        let finalOwnerPubkey: string =
          getRepoOwnerPubkey(repoData, entity) || "";
        if (!finalOwnerPubkey || !/^[0-9a-f]{64}$/i.test(finalOwnerPubkey)) {
          // Try to resolve from entity
          const resolved = resolveEntityToPubkey(entity, repoData);
          if (!resolved || !/^[0-9a-f]{64}$/i.test(resolved)) {
            setErrorMsg(
              "Cannot determine repository owner. Please ensure the repository is properly configured."
            );
            setSubmitting(false);
            return;
          }
          finalOwnerPubkey = resolved;
        }

        // TypeScript guard: ensure finalOwnerPubkey is defined
        if (!finalOwnerPubkey || !/^[0-9a-f]{64}$/i.test(finalOwnerPubkey)) {
          setErrorMsg(
            "Cannot determine repository owner. Please ensure the repository is properly configured."
          );
          setSubmitting(false);
          return;
        }

        // Get earliest unique commit (optional but recommended for NIP-34 "r" tag)
        const earliestUniqueCommit =
          (repoData as any).earliestUniqueCommit ||
          (repoData.commits &&
          Array.isArray(repoData.commits) &&
          repoData.commits.length > 0
            ? (repoData.commits[0] as any)?.id
            : undefined);

        let issueEvent: any;
        let authorPubkey: string;

        if (hasNip07 && window.nostr) {
          // Use NIP-07 extension
          authorPubkey = await window.nostr.getPublicKey();

          // Auto-assign creator if not already assigned
          const finalAssignees = selectedAssignees.includes(authorPubkey)
            ? selectedAssignees
            : [authorPubkey, ...selectedAssignees];

          // Create NIP-34 compliant event
          const tags: string[][] = [
            // ["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"] - REQUIRED
            ["a", `30617:${finalOwnerPubkey}:${repo}`],
            // ["r", "<earliest-unique-commit-id-of-repo>"] - REQUIRED (helps clients subscribe)
            ...(earliestUniqueCommit ? [["r", earliestUniqueCommit]] : []),
            // ["p", "<repository-owner>"] - REQUIRED
            ["p", finalOwnerPubkey],
            // ["subject", "<issue-subject>"] - REQUIRED
            ["subject", title],
          ];

          // Optional tags
          if (selectedLabels && selectedLabels.length > 0) {
            selectedLabels.forEach((label) => tags.push(["t", label]));
          }

          // Custom extensions (not in NIP-34 but we keep for backward compatibility)
          if (finalAssignees && finalAssignees.length > 0) {
            finalAssignees.forEach((assignee) =>
              tags.push(["p", assignee, "assignee"])
            );
          }
          if (selectedProject) {
            tags.push(["project", selectedProject]);
          }
          if (selectedMilestone) {
            tags.push(["milestone", selectedMilestone]);
          }

          issueEvent = {
            kind: KIND_ISSUE, // NIP-34: kind 1621
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: description, // Markdown text per NIP-34 (not JSON)
            pubkey: authorPubkey,
            id: "",
            sig: "",
          };

          // Hash event
          issueEvent.id = getEventHash(issueEvent);

          // Sign with NIP-07
          const signedEvent = await window.nostr.signEvent(issueEvent);
          issueEvent = signedEvent;
        } else if (privateKey) {
          // Use private key
          authorPubkey = getPublicKey(privateKey);

          // Auto-assign creator if not already assigned
          const finalAssignees = selectedAssignees.includes(authorPubkey)
            ? selectedAssignees
            : [authorPubkey, ...selectedAssignees];

          issueEvent = createIssueEvent(
            {
              repoEntity: entity,
              repoName: repo,
              ownerPubkey: finalOwnerPubkey, // Required for NIP-34
              earliestUniqueCommit,
              title,
              description,
              labels: selectedLabels,
              assignees: finalAssignees,
              status: "open",
              projectId: selectedProject || undefined,
              milestoneId: selectedMilestone || undefined,
            },
            privateKey
          );
        } else {
          throw new Error("No signing method available");
        }

        // Store locally (use double underscore to match issues page)
        try {
          const key = `gittr_issues__${entity}__${repo}`;
          const existingIssues = JSON.parse(localStorage.getItem(key) || "[]");

          // Calculate next issue number based on existing issues
          const maxNumber = existingIssues.reduce((max: number, issue: any) => {
            const num = parseInt(issue.number || "0", 10);
            return Math.max(max, num);
          }, 0);

          // Auto-assign creator if not already assigned
          const finalAssignees = selectedAssignees.includes(authorPubkey)
            ? selectedAssignees
            : [authorPubkey, ...selectedAssignees];

          const newIssue = {
            id: issueEvent.id,
            entity: entity, // Add for issues page compatibility
            repo: repo, // Add for issues page compatibility
            repoEntity: entity,
            repoName: repo,
            title,
            description,
            labels: selectedLabels || [],
            assignees: finalAssignees || [],
            status: "open",
            author: authorPubkey,
            createdAt: Date.now(),
            number: String(maxNumber + 1), // Use max + 1 to avoid duplicates
            projectId: selectedProject || undefined,
            milestoneId: selectedMilestone || undefined,
            // Bounty info if added during creation
            bountyAmount: bountyAmount > 0 ? bountyAmount : undefined,
            // LNURL-withdraw bounty (new system)
            bountyWithdrawId: bountyWithdrawId || undefined,
            bountyLnurl: bountyLnurl || undefined,
            bountyWithdrawUrl: bountyWithdrawUrl || undefined,
            bountyStatus: bountyWithdrawId ? ("paid" as const) : undefined, // LNURL-withdraw is automatically funded
            // Legacy invoice-based bounty (for backwards compatibility)
            bountyInvoice: bountyInvoice || undefined,
            bountyPaymentHash: bountyPaymentHash || undefined,
          };

          existingIssues.push(newIssue);
          localStorage.setItem(key, JSON.stringify(existingIssues));

          console.log("Issue saved locally:", newIssue);
          console.log("Total issues now:", existingIssues.length);

          // Dispatch event to notify issues page
          window.dispatchEvent(
            new CustomEvent("gittr:issue-created", { detail: newIssue })
          );

          // Send notification to repo watchers about new issue
          try {
            // Get repo owner pubkey for notification
            const repos = JSON.parse(
              localStorage.getItem("gittr_repos") || "[]"
            );
            const repoData = repos.find(
              (r: any) => r.entity === entity && r.repo === repo
            );
            const ownerPubkey = getRepoOwnerPubkey(repoData, entity);

            if (ownerPubkey) {
              const notification = formatNotificationMessage("issue_opened", {
                repoEntity: entity,
                repoName: repo,
                issueId: newIssue.number || newIssue.id,
                issueTitle: newIssue.title,
                url:
                  typeof window !== "undefined"
                    ? `${window.location.origin}/${entity}/${repo}/issues/${newIssue.id}`
                    : undefined,
              });

              await sendNotification({
                eventType: "issue_opened",
                title: notification.title,
                message: notification.message,
                url: notification.url,
                repoEntity: entity,
                repoName: repo,
                recipientPubkey: ownerPubkey,
              });
            }
          } catch (error) {
            console.error("Failed to send issue_opened notification:", error);
            // Don't block issue creation if notification fails
          }

          // Detect @mentions in description and send notifications
          try {
            const mentionedPubkeys = extractMentionedPubkeys(description);
            const uniqueMentions = Array.from(new Set(mentionedPubkeys));

            // Filter out the issue author (don't notify yourself)
            const mentionsToNotify = uniqueMentions.filter(
              (pubkey) => pubkey.toLowerCase() !== authorPubkey.toLowerCase()
            );

            if (mentionsToNotify.length > 0) {
              const notification = formatNotificationMessage("mention", {
                repoEntity: entity,
                repoName: repo,
                issueId: newIssue.number || newIssue.id,
                issueTitle: newIssue.title,
                authorName: userName || "Someone",
                url:
                  typeof window !== "undefined"
                    ? `${window.location.origin}/${entity}/${repo}/issues/${newIssue.id}`
                    : undefined,
              });

              // Send notification to each mentioned user
              await Promise.all(
                mentionsToNotify.map((pubkey) =>
                  sendNotification({
                    eventType: "mention",
                    title: notification.title,
                    message: notification.message,
                    url: notification.url,
                    repoEntity: entity,
                    repoName: repo,
                    recipientPubkey: pubkey,
                  }).catch((err) => {
                    console.error(
                      `Failed to send mention notification to ${pubkey.slice(
                        0,
                        8
                      )}...:`,
                      err
                    );
                  })
                )
              );
            }
          } catch (error) {
            console.error("Failed to send mention notifications:", error);
            // Don't block issue creation if mention notifications fail
          }
        } catch (err) {
          console.error("Failed to save issue locally:", err);
          setErrorMsg(`Failed to save issue: ${err}`);
          setSubmitting(false);
          return;
        }

        // Publish to Nostr relays (optional - issue is already saved locally)
        if (publish && defaultRelays && defaultRelays.length > 0) {
          publish(issueEvent, defaultRelays);
          console.log("Published issue to Nostr:", issueEvent.id);

          // Create and publish NIP-34 status event (kind 1630: Open)
          try {
            const privateKey = await getNostrPrivateKey();
            const hasNip07 = typeof window !== "undefined" && window.nostr;

            if (privateKey || hasNip07) {
              let statusEvent: any;

              if (hasNip07 && window.nostr) {
                const authorPubkey = await window.nostr.getPublicKey();
                statusEvent = {
                  kind: KIND_STATUS_OPEN,
                  created_at: Math.floor(Date.now() / 1000),
                  tags: [
                    ["e", issueEvent.id, "", "root"],
                    ["p", finalOwnerPubkey],
                    ["p", authorPubkey],
                    ["a", `30617:${finalOwnerPubkey}:${repo}`],
                  ],
                  content: `Opened issue`,
                  pubkey: authorPubkey,
                  id: "",
                  sig: "",
                };
                statusEvent.id = getEventHash(statusEvent);
                statusEvent = await window.nostr.signEvent(statusEvent);
              } else if (privateKey) {
                statusEvent = createStatusEvent(
                  {
                    statusKind: KIND_STATUS_OPEN,
                    rootEventId: issueEvent.id,
                    ownerPubkey: finalOwnerPubkey,
                    rootEventAuthor: authorPubkey,
                    repoName: repo,
                    content: `Opened issue`,
                  },
                  privateKey
                );
              }

              if (statusEvent) {
                publish(statusEvent, defaultRelays);
                console.log(
                  "✅ Published NIP-34 status event (open):",
                  statusEvent.id
                );
              }
            }
          } catch (statusError) {
            console.error("Failed to publish status event:", statusError);
            // Don't block issue creation if status event publishing fails
          }
        } else {
          console.warn(
            "Publish function not available - issue saved locally only"
          );
        }

        setSubmitting(false);

        // Navigate to issues page - the custom event will trigger a reload
        router.push(`/${entity}/${repo}/issues`);
      } catch (error: any) {
        setErrorMsg(`Failed to create issue: ${error.message}`);
        setSubmitting(false);
      }
    },
    [
      router,
      isLoggedIn,
      publish,
      defaultRelays,
      params,
      selectedLabels,
      selectedAssignees,
      selectedProject,
      selectedMilestone,
      submitting,
      bountyAmount,
      bountyWithdrawId,
      bountyLnurl,
      bountyWithdrawUrl,
      bountyInvoice,
      bountyPaymentHash,
      currentUserPubkey,
    ]
  );

  const handleAddAssignee = useCallback(
    (input: string) => {
      if (!input.trim()) return;

      try {
        let pubkey = input.trim();

        // If it's an npub, decode it
        if (pubkey.startsWith("npub")) {
          const decoded = nip19.decode(pubkey);
          if (decoded.type === "npub") {
            pubkey = decoded.data as string;
          }
        }

        // Validate pubkey (should be 64 hex chars)
        if (!/^[a-f0-9]{64}$/i.test(pubkey)) {
          setErrorMsg("Invalid npub or pubkey format");
          setTimeout(() => setErrorMsg(""), 3000);
          return;
        }

        if (!selectedAssignees.includes(pubkey)) {
          setSelectedAssignees([...selectedAssignees, pubkey]);
          setAssigneeInputValue("");
        }
      } catch (error: any) {
        setErrorMsg(`Failed to add assignee: ${error.message}`);
        setTimeout(() => setErrorMsg(""), 3000);
      }
    },
    [selectedAssignees]
  );

  const handleRemoveAssignee = useCallback(
    (pubkey: string) => {
      setSelectedAssignees(selectedAssignees.filter((a) => a !== pubkey));
    },
    [selectedAssignees]
  );

  const selectLabel = (label: string) => {
    if (!selectedLabels.includes(label)) {
      setSelectedLabels([label, ...selectedLabels]);
    } else {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    }
  };

  const handleFilter = () => {
    const value = labelsFilterRef.current?.value || "";
    const updatedLabels = availableLabels.filter((label) =>
      label.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredLabels(updatedLabels);
  };

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] px-6 py-8">
      <div className="flex gap-6">
        {/* Main Form - Wider */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-3 mb-4">
            <Avatar className="w-8 h-8 overflow-hidden shrink-0">
              {picture && picture.startsWith("http") ? (
                <AvatarImage
                  src={picture}
                  className="w-8 h-8 object-cover max-w-8 max-h-8"
                  decoding="async"
                  loading="lazy"
                  style={{ maxWidth: "2rem", maxHeight: "2rem" }}
                />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="bg-[#171B21] py-4 px-6 shadow rounded-lg">
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div>
                    <div className="mt-2">
                      <Input
                        id="title"
                        name="title"
                        type="text"
                        required
                        placeholder="Title"
                        className="w-full block text-lg"
                        ref={titleRef}
                      />
                      <Textarea
                        id="comment"
                        name="comment"
                        required
                        placeholder="Leave a comment"
                        className="block h-96 mt-4 text-base"
                        ref={commentRef}
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <Button
                      variant={"success"}
                      type="submit"
                      className="flex w-full mb-2 justify-center"
                    >
                      Submit new issue
                    </Button>
                    {errorMsg && (
                      <p className="text-red-500 mt-2">{errorMsg}</p>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 flex-shrink-0">
          <div className="flex flex-col gap-3 p-4 divide-y divide-gray-700 bg-[#171B21] shadow rounded-lg">
            <div className="flex">
              <div className="flex flex-col w-full p-2">
                <div className="flex hover:text-purple-400 cursor-pointer">
                  <p className="w-full mb-2">Assignees</p>
                  <div className="hidden items-center md:inline">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Settings />
                          <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-80"
                        onInteractOutside={(e) => {
                          // Don't close when clicking inside the input
                          const target = e.target as HTMLElement;
                          if (
                            target.closest("input") ||
                            target.closest('button[type="button"]')
                          ) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <DropdownMenuLabel>
                          Assign up to 10 people to this issue.
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <div className="p-2 space-y-2">
                          <NostrUserSearch
                            value={assigneeInputValue}
                            onChange={setAssigneeInputValue}
                            onSelect={(user) => {
                              // Add user by pubkey (handleAddAssignee will decode npub if needed)
                              handleAddAssignee(user.pubkey);
                            }}
                            placeholder="Search by name, npub, or pubkey..."
                            disabled={selectedAssignees.length >= 10}
                            maxResults={10}
                          />
                          {assigneeInputValue.trim() && (
                            <Button
                              type="button"
                              size="sm"
                              className="w-full"
                              onClick={() => {
                                if (assigneeInputValue.trim()) {
                                  handleAddAssignee(assigneeInputValue);
                                }
                              }}
                              disabled={selectedAssignees.length >= 10}
                            >
                              Add
                            </Button>
                          )}
                          {currentUserPubkey && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() =>
                                handleAddAssignee(currentUserPubkey)
                              }
                              disabled={selectedAssignees.includes(
                                currentUserPubkey
                              )}
                            >
                              Assign yourself
                            </Button>
                          )}
                          {selectedAssignees.length > 0 && (
                            <div className="border-t border-gray-700 pt-2 mt-2">
                              <p className="text-xs text-gray-400 mb-2">
                                Assigned ({selectedAssignees.length}/10):
                              </p>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {selectedAssignees.map((pubkey) => {
                                  const meta = assigneeMetadata[pubkey];
                                  const displayName =
                                    meta?.display_name ||
                                    meta?.name ||
                                    pubkey.slice(0, 8) + "...";
                                  const npub =
                                    pubkey.length === 64
                                      ? (() => {
                                          try {
                                            return nip19.npubEncode(pubkey);
                                          } catch {
                                            return null;
                                          }
                                        })()
                                      : null;

                                  return (
                                    <div
                                      key={pubkey}
                                      className="flex items-center justify-between text-xs bg-gray-800 p-1.5 rounded group"
                                      title={
                                        npub
                                          ? `npub: ${npub}`
                                          : `pubkey: ${pubkey}`
                                      }
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <Avatar className="h-4 w-4">
                                          {meta?.picture &&
                                          meta.picture.startsWith("http") ? (
                                            <AvatarImage src={meta.picture} />
                                          ) : null}
                                          <AvatarFallback className="bg-gray-700 text-white text-[8px]">
                                            {displayName
                                              .slice(0, 2)
                                              .toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="text-purple-300">
                                          {displayName}
                                        </span>
                                        {npub && (
                                          <span className="text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                                            ({npub.slice(0, 12)}...)
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemoveAssignee(pubkey)
                                        }
                                        className="text-red-400 hover:text-red-300"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        {repoContributors.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <div className="p-2 space-y-2">
                              <p className="text-xs text-gray-400 mb-2">
                                Repository Contributors:
                              </p>
                              <div className="space-y-1 max-h-40 overflow-y-auto">
                                {repoContributors
                                  .filter(
                                    (c) => !selectedAssignees.includes(c.pubkey)
                                  )
                                  .map((contributor) => {
                                    const meta =
                                      repoContributorMetadata[
                                        contributor.pubkey
                                      ];
                                    const displayName =
                                      meta?.display_name ||
                                      meta?.name ||
                                      contributor.name ||
                                      contributor.pubkey.slice(0, 8) + "...";
                                    const npub = (() => {
                                      try {
                                        return nip19.npubEncode(
                                          contributor.pubkey
                                        );
                                      } catch {
                                        return null;
                                      }
                                    })();

                                    return (
                                      <button
                                        key={contributor.pubkey}
                                        type="button"
                                        onClick={() =>
                                          handleAddAssignee(contributor.pubkey)
                                        }
                                        className="w-full flex items-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 p-2 rounded transition-colors group"
                                        disabled={
                                          selectedAssignees.length >= 10
                                        }
                                        title={
                                          npub
                                            ? `npub: ${npub}`
                                            : `pubkey: ${contributor.pubkey}`
                                        }
                                      >
                                        <Avatar className="h-5 w-5 flex-shrink-0">
                                          {(meta?.picture ||
                                            contributor.picture) &&
                                          (
                                            meta?.picture || contributor.picture
                                          )?.startsWith("http") ? (
                                            <AvatarImage
                                              src={
                                                meta?.picture ||
                                                contributor.picture
                                              }
                                            />
                                          ) : null}
                                          <AvatarFallback className="bg-gray-700 text-white text-[8px]">
                                            {displayName
                                              .slice(0, 2)
                                              .toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="text-purple-300 flex-1 text-left truncate">
                                          {displayName}
                                        </span>
                                        {contributor.role && (
                                          <span className="text-[10px] text-gray-500 capitalize">
                                            {contributor.role}
                                          </span>
                                        )}
                                        {npub && (
                                          <span className="text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono truncate max-w-[60px]">
                                            ({npub.slice(0, 8)}...)
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="space-y-1">
                  {selectedAssignees.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedAssignees.map((pubkey) => {
                        const meta = assigneeMetadata[pubkey];
                        const displayName =
                          meta?.display_name ||
                          meta?.name ||
                          pubkey.slice(0, 8) + "...";
                        const npub =
                          pubkey.length === 64
                            ? (() => {
                                try {
                                  return nip19.npubEncode(pubkey);
                                } catch {
                                  return null;
                                }
                              })()
                            : null;

                        return (
                          <span
                            key={pubkey}
                            className="text-xs bg-purple-900/30 text-purple-300 px-2 py-1 rounded flex items-center gap-1.5 group"
                            title={npub ? `npub: ${npub}` : `pubkey: ${pubkey}`}
                          >
                            <Avatar className="h-4 w-4">
                              {meta?.picture &&
                              meta.picture.startsWith("http") ? (
                                <AvatarImage src={meta.picture} />
                              ) : null}
                              <AvatarFallback className="bg-gray-700 text-white text-[8px]">
                                {displayName.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span>{displayName}</span>
                            {npub && (
                              <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                                ({npub.slice(0, 12)}...)
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignee(pubkey)}
                              className="ml-1 text-purple-400 hover:text-purple-200"
                            >
                              <X className="h-3 w-3 inline" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span>
                      <span className="text-grey-300/20">No one yet ––</span>
                      {currentUserPubkey && (
                        <span
                          className="cursor-pointer text-purple-400 hover:text-purple-300"
                          onClick={() => handleAddAssignee(currentUserPubkey)}
                        >
                          {" "}
                          assign yourself
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex">
              <div className="flex flex-col w-full p-2">
                <div className="flex hover:text-purple-400 cursor-pointer">
                  <p className="w-full mb-2">Labels</p>
                  <div className="hidden items-center md:inline">
                    <DropdownMenu onOpenChange={handleFilter}>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Settings />
                          <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56">
                        <DropdownMenuLabel>
                          Apply labels to this issue.
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <Input
                          id="labelsFilter"
                          name="labelsFilter"
                          type="text"
                          placeholder="Filter labels"
                          className="w-full block"
                          onChange={handleFilter}
                          ref={labelsFilterRef}
                        />
                        <DropdownMenuSeparator />
                        {/* Labels loaded from repo topics */}
                        <DropdownMenuGroup>
                          {filteredLabels.map((label) => {
                            return (
                              <div key={label}>
                                <div
                                  className="flex cursor-pointer p-1"
                                  onClick={() => selectLabel(label)}
                                >
                                  <span className="mr-1">{label}</span>
                                  {selectedLabels.includes(label) && <Check />}
                                </div>
                                <DropdownMenuSeparator />
                              </div>
                            );
                          })}
                          <div className="flex cursor-pointer p-1">
                            <Edit />
                            <Link href={"#"} className="ml-2">
                              {"Edit labels"}
                            </Link>
                          </div>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {selectedLabels.length > 0 ? (
                    selectedLabels.map((label) => (
                      <Badge
                        key={label}
                        variant="outline"
                        className="border-purple-700 text-purple-400 bg-purple-900/20"
                      >
                        {label}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-gray-300">None yet</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex">
              <div className="flex flex-col w-full p-2">
                <div className="flex hover:text-purple-400 cursor-pointer">
                  <p className="w-full mb-2">Projects</p>
                  <div className="hidden items-center md:inline">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Settings />
                          <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56">
                        <DropdownMenuLabel>Add to project</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {availableProjects.length > 0 ? (
                          <DropdownMenuGroup>
                            {availableProjects.map((project) => (
                              <DropdownMenuItem
                                key={project.id}
                                onClick={() =>
                                  setSelectedProject(
                                    selectedProject === project.id
                                      ? null
                                      : project.id
                                  )
                                }
                                className={
                                  selectedProject === project.id
                                    ? "bg-purple-900/50"
                                    : ""
                                }
                              >
                                {selectedProject === project.id && (
                                  <Check className="mr-2 h-4 w-4" />
                                )}
                                {project.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuGroup>
                        ) : (
                          <DropdownMenuItem disabled className="text-gray-400">
                            No projects yet
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="mt-1">
                  {selectedProject ? (
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="border-purple-700 text-purple-400 bg-purple-900/20"
                      >
                        {
                          availableProjects.find(
                            (p) => p.id === selectedProject
                          )?.name
                        }
                        <button
                          type="button"
                          onClick={() => setSelectedProject(null)}
                          className="ml-1 hover:text-red-400"
                        >
                          <X className="h-3 w-3 inline" />
                        </button>
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-gray-300">None yet</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex">
              <div className="flex flex-col w-full p-2">
                <div className="flex hover:text-purple-400 cursor-pointer">
                  <p className="w-full mb-2">Milestones</p>
                  <div className="hidden items-center md:inline">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="flex items-center cursor-pointer">
                          <Settings />
                          <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56">
                        <DropdownMenuLabel>Set milestone</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {availableMilestones.length > 0 ? (
                          <DropdownMenuGroup>
                            {availableMilestones.map((milestone) => (
                              <DropdownMenuItem
                                key={milestone.id}
                                onClick={() =>
                                  setSelectedMilestone(
                                    selectedMilestone === milestone.id
                                      ? null
                                      : milestone.id
                                  )
                                }
                                className={
                                  selectedMilestone === milestone.id
                                    ? "bg-purple-900/50"
                                    : ""
                                }
                              >
                                {selectedMilestone === milestone.id && (
                                  <Check className="mr-2 h-4 w-4" />
                                )}
                                {milestone.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuGroup>
                        ) : (
                          <DropdownMenuItem disabled className="text-gray-400">
                            No milestones yet
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="mt-1">
                  {selectedMilestone ? (
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="border-purple-700 text-purple-400 bg-purple-900/20"
                      >
                        {
                          availableMilestones.find(
                            (m) => m.id === selectedMilestone
                          )?.name
                        }
                        <button
                          type="button"
                          onClick={() => setSelectedMilestone(null)}
                          className="ml-1 hover:text-red-400"
                        >
                          <X className="h-3 w-3 inline" />
                        </button>
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-gray-300">No milestone</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex">
              <div className="flex flex-col w-full p-2">
                <div className="flex hover:text-purple-400 cursor-pointer">
                  <p className="w-full mb-2">Bounty</p>
                  <Coins className="h-4 w-4 ml-2" />
                </div>
                <div className="mt-1">
                  <p className="text-xs text-gray-400 mb-2">
                    Add a bounty to motivate developers to fix this issue. The
                    bounty will be paid from your sending wallet when the issue
                    is resolved.
                  </p>
                  <BountyButton
                    issueId={`${params?.entity}/${params?.repo}/new`} // Temporary ID, will be replaced with actual issue ID after creation
                    issueTitle={titleRef.current?.value || ""}
                    repoEntity={
                      typeof params?.entity === "string"
                        ? params.entity
                        : undefined
                    }
                    repoName={
                      typeof params?.repo === "string" ? params.repo : undefined
                    }
                    onBountyCreated={(
                      withdrawId: string,
                      lnurl: string,
                      withdrawUrl: string,
                      amount: number
                    ) => {
                      setBountyWithdrawId(withdrawId);
                      setBountyLnurl(lnurl);
                      setBountyWithdrawUrl(withdrawUrl);
                      setBountyAmount(amount);
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  />
                  {bountyAmount > 0 && (
                    <div className="mt-2 p-2 bg-green-900/20 border border-green-700 rounded text-sm text-green-400">
                      💰 {bountyAmount.toLocaleString()} sats bounty added (paid
                      via LNURL-withdraw)
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
