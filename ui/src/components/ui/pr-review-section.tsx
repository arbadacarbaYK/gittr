"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MessageSquare } from "lucide-react";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { type StoredRepo, type StoredContributor } from "@/lib/repos/storage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface Review {
  id: string;
  reviewer: string; // pubkey
  reviewerName?: string;
  reviewerPicture?: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  body?: string; // Review comment
  submittedAt: number;
}

interface PRReviewSectionProps {
  prId: string;
  entity: string;
  repo: string;
  requiredApprovals?: number; // From repo settings
  prAuthor?: string; // PR author pubkey - if same as owner, bypasses approvals
  isOwner?: boolean; // Whether current user is repo owner
}

export function PRReviewSection({ prId, entity, repo, requiredApprovals = 1, prAuthor, isOwner }: PRReviewSectionProps) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const { picture: userPicture, name: userName } = useSession();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewState, setReviewState] = useState<"APPROVED" | "CHANGES_REQUESTED" | "COMMENTED">("COMMENTED");
  const [reviewComment, setReviewComment] = useState("");
  const [isContributor, setIsContributor] = useState(false);
  const [repoData, setRepoData] = useState<any>(null);

  const storageKey = `gittr_pr_reviews__${entity}__${repo}__${prId}`;

  // Load reviews
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setReviews(stored);
    } catch {}
  }, [storageKey]);

  // Load repo data and check if current user can approve PRs (owner, maintainer, or contributor)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const foundRepo = findRepoByEntityAndName(repos, entity, repo);
      
      setRepoData(foundRepo);
      
      if (foundRepo && currentUserPubkey) {
        // Check if user is owner
        const foundRepoWithContributors = foundRepo as StoredRepo;
        const isRepoOwner = foundRepoWithContributors.ownerPubkey === currentUserPubkey ||
          foundRepoWithContributors.contributors?.some((c: StoredContributor) =>
            c.pubkey === currentUserPubkey &&
            (c.role === "owner" || (c.role === undefined && c.weight === 100))
          );
        
        // Check if user is maintainer
        const isMaintainer = foundRepoWithContributors.contributors?.some((c: StoredContributor) => 
          c.pubkey === currentUserPubkey && 
          (c.role === "maintainer" || (c.role === undefined && c.weight !== undefined && c.weight >= 50 && c.weight < 100))
        );
        
        // Check if user is contributor (any role or weight > 0)
        const isRepoContributor = foundRepoWithContributors.contributors?.some((c: StoredContributor) => 
          c.pubkey === currentUserPubkey && 
          (c.role === "contributor" || 
           (c.role === undefined && c.weight !== undefined && c.weight > 0 && c.weight < 50))
        );
        
        setIsContributor(isRepoOwner || isMaintainer || isRepoContributor || false);
      }
    } catch {
      setIsContributor(false);
      setRepoData(null);
    }
  }, [entity, repo, currentUserPubkey]);

  const handleSubmitReview = useCallback(() => {
    if (!currentUserPubkey) {
      alert("Please log in to submit a review");
      return;
    }

    const newReview: Review = {
      id: `review-${Date.now()}`,
      reviewer: currentUserPubkey,
      reviewerName: userName || currentUserPubkey.slice(0, 8),
      reviewerPicture: userPicture || undefined,
      state: reviewState,
      body: reviewComment.trim() || undefined,
      submittedAt: Date.now(),
    };

    // Check if user already reviewed - update existing review
    const updatedReviews = reviews.filter(r => r.reviewer !== currentUserPubkey);
    updatedReviews.push(newReview);
    updatedReviews.sort((a, b) => b.submittedAt - a.submittedAt);

    if (typeof window !== 'undefined') {
    localStorage.setItem(storageKey, JSON.stringify(updatedReviews));
    }
    setReviews(updatedReviews);
    setShowReviewForm(false);
    setReviewComment("");
    setReviewState("COMMENTED");
  }, [currentUserPubkey, reviewState, reviewComment, reviews, storageKey, userName, userPicture]);

  // Only count approvals from users with merge rights (owners/maintainers), excluding PR author
  const approvalsFromMergeRightsHolders = reviews
    .filter((r: any) => {
      // Exclude PR author's approval
      if (r.reviewer === prAuthor) return false;
      
      // Check if reviewer has merge rights
      if (!repoData?.contributors) return false;
      
      const reviewer = repoData.contributors.find((c: any) => c.pubkey === r.reviewer);
      if (!reviewer) return false;
      
      // Check if reviewer is owner or maintainer
      const reviewerIsOwner = reviewer.role === "owner" || 
        (reviewer.role === undefined && reviewer.weight === 100) ||
        repoData.ownerPubkey === r.reviewer;
      const reviewerIsMaintainer = reviewer.role === "maintainer" || 
        (reviewer.role === undefined && reviewer.weight >= 50 && reviewer.weight < 100);
      
      // Only count if reviewer has merge rights AND approved
      return (reviewerIsOwner || reviewerIsMaintainer) && r.state === "APPROVED";
    })
    .length;
  
  const allApprovals = reviews.filter(r => r.state === "APPROVED").length; // For display
  const changeRequests = reviews.filter(r => r.state === "CHANGES_REQUESTED").length;
  const userReview = reviews.find(r => r.reviewer === currentUserPubkey);
  
  // Check if PR author is the owner/maintainer - can merge own PRs without approvals
  // Need to check if current user is owner/maintainer AND PR author matches
  const [isCurrentUserOwner, setIsCurrentUserOwner] = useState(false);
  const [isCurrentUserMaintainer, setIsCurrentUserMaintainer] = useState(false);
  
  useEffect(() => {
    if (!repoData || !currentUserPubkey) {
      setIsCurrentUserOwner(false);
      setIsCurrentUserMaintainer(false);
      return;
    }
    
    // Check if current user is owner
    const repoOwner = repoData.ownerPubkey === currentUserPubkey ||
      repoData.contributors?.some((c: any) => 
        c.pubkey === currentUserPubkey && 
        (c.role === "owner" || (c.role === undefined && c.weight === 100))
      );
    
    // Check if current user is maintainer
    const repoMaintainer = repoData.contributors?.some((c: any) => 
      c.pubkey === currentUserPubkey && 
      (c.role === "maintainer" || (c.role === undefined && c.weight >= 50 && c.weight < 100))
    );
    
    setIsCurrentUserOwner(!!repoOwner);
    setIsCurrentUserMaintainer(!!repoMaintainer);
  }, [repoData, currentUserPubkey]);
  
  const isOwnerPR = isCurrentUserOwner && prAuthor === currentUserPubkey;
  const isMaintainerPR = isCurrentUserMaintainer && prAuthor === currentUserPubkey;
  const canMergeOwnPR = isOwnerPR || isMaintainerPR;
  
  const canMerge = canMergeOwnPR || (requiredApprovals === 0 || (approvalsFromMergeRightsHolders >= requiredApprovals && changeRequests === 0));

  return (
    <div className="border border-gray-700 rounded p-4">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h3 className="font-semibold">Reviews</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {allApprovals > 0 && (
            <Badge className="theme-bg-accent-primary">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {allApprovals} {allApprovals === 1 ? "approval" : "approvals"}
              {approvalsFromMergeRightsHolders < allApprovals && ` (${approvalsFromMergeRightsHolders} from owners/maintainers)`}
            </Badge>
          )}
          {changeRequests > 0 && (
            <Badge className="bg-red-600">
              <XCircle className="h-3 w-3 mr-1" />
              {changeRequests} change {changeRequests === 1 ? "request" : "requests"}
            </Badge>
          )}
          {canMerge && (
            <Badge className="theme-bg-accent-primary">
              {canMergeOwnPR ? "Owner/Maintainer PR - ready to merge" : "Ready to merge"}
            </Badge>
          )}
          {!canMergeOwnPR && requiredApprovals > 0 && requiredApprovals > approvalsFromMergeRightsHolders && (
            <Badge variant="outline" className="text-gray-400">
              {requiredApprovals - approvalsFromMergeRightsHolders} more {requiredApprovals - approvalsFromMergeRightsHolders === 1 ? "approval" : "approvals"} required from owners/maintainers
            </Badge>
          )}
          {requiredApprovals === 0 && !canMergeOwnPR && (
            <Badge variant="outline" className="text-gray-400">
              No approvals required
            </Badge>
          )}
        </div>
      </div>

      {/* Reviews List */}
      {reviews.length > 0 ? (
        <div className="space-y-3 mb-4">
          {reviews.map((review) => {
            const Icon = review.state === "APPROVED" 
              ? CheckCircle2 
              : review.state === "CHANGES_REQUESTED" 
              ? XCircle 
              : MessageSquare;
            const color = review.state === "APPROVED" 
              ? "text-green-500" 
              : review.state === "CHANGES_REQUESTED" 
              ? "text-red-500" 
              : "text-gray-400";

            return (
              <div key={review.id} className="flex gap-3 p-3 bg-gray-800 rounded">
                <Avatar className="h-8 w-8 shrink-0 overflow-hidden">
                  {review.reviewerPicture && review.reviewerPicture.startsWith("http") ? (
                    <AvatarImage 
                      src={review.reviewerPicture} 
                      className="object-cover max-w-full max-h-full"
                      style={{ maxWidth: '100%', maxHeight: '100%' }}
                    />
                  ) : null}
                  <AvatarFallback>{review.reviewerName?.slice(0, 2).toUpperCase() || review.reviewer.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{review.reviewerName || review.reviewer.slice(0, 8)}</span>
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className={`text-sm ${color}`}>
                      {review.state === "APPROVED" && "approved"}
                      {review.state === "CHANGES_REQUESTED" && "requested changes"}
                      {review.state === "COMMENTED" && "commented"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDateTime24h(review.submittedAt)}
                    </span>
                  </div>
                  {review.body && (
                    <div className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{review.body}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400 mb-4">No reviews yet</p>
      )}

      {/* Review Form */}
      {!userReview && (isContributor || isOwner) ? (
        showReviewForm ? (
          <div className="border-t border-gray-700 pt-4">
            <div className="mb-3">
              <label className="block text-sm font-medium mb-2">Review</label>
              <div className="flex gap-2 mb-3">
                <Button
                  size="sm"
                  variant={reviewState === "APPROVED" ? "default" : "outline"}
                  onClick={() => setReviewState("APPROVED")}
                  className={reviewState === "APPROVED" ? "theme-bg-accent-primary" : ""}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant={reviewState === "CHANGES_REQUESTED" ? "default" : "outline"}
                  onClick={() => setReviewState("CHANGES_REQUESTED")}
                  className={reviewState === "CHANGES_REQUESTED" ? "bg-red-600 hover:bg-red-700" : ""}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Request changes
                </Button>
                <Button
                  size="sm"
                  variant={reviewState === "COMMENTED" ? "default" : "outline"}
                  onClick={() => setReviewState("COMMENTED")}
                >
                  <MessageSquare className="h-4 w-4 mr-1" />
                  Comment
                </Button>
              </div>
              <Textarea
                className="bg-gray-800 border-gray-600 text-white mb-3"
                placeholder="Add a review comment (optional)"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={4}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleSubmitReview}
                  variant="default"
                >
                  Submit review
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReviewForm(false);
                    setReviewComment("");
                    setReviewState("COMMENTED");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setShowReviewForm(true)}
            className="w-full"
            variant="default"
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Add review
          </Button>
        )
      ) : userReview ? (
        <div className="border-t border-gray-700 pt-4">
          <p className="text-sm text-gray-400">You've already submitted a review</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReviewForm(true)}
            className="mt-2"
          >
            Update review
          </Button>
        </div>
      ) : (
        <div className="text-sm text-gray-500 bg-gray-800/50 p-2 rounded">
          Only repository owners, maintainers, and contributors can approve or request changes to PRs.
        </div>
      )}
    </div>
  );
}

