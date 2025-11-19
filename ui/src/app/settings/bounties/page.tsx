"use client";

import { useEffect, useState } from "react";
import SettingsHero from "@/components/settings-hero";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Coins, CheckCircle2, Clock, X } from "lucide-react";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface BountyEntry {
  issueId: string;
  issueTitle: string;
  repoId: string;
  amount: number;
  paymentHash: string;
  status: "pending" | "paid" | "released" | "claimed";
  createdAt: number;
  claimedBy?: string; // pubkey of user who claimed
  claimedAt?: number;
  releasedAt?: number;
}

export default function BountiesSettingsPage() {
  const [bounties, setBounties] = useState<BountyEntry[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("gittr_user_bounties") || "[]");
      // Sort by created date (newest first)
      stored.sort((a: BountyEntry, b: BountyEntry) => b.createdAt - a.createdAt);
      setBounties(stored);
    } catch (error) {
      console.error("Failed to load bounties:", error);
    }
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" /> Paid</Badge>;
      case "released":
        return <Badge className="bg-purple-600">Released</Badge>;
      case "claimed":
        return <Badge className="bg-yellow-600">Claimed</Badge>;
      default:
        return <Badge className="bg-gray-600"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
    }
  };

  const getStatusDescription = (bounty: BountyEntry) => {
    switch (bounty.status) {
      case "pending":
        return "Waiting for payment...";
      case "paid":
        return "Payment confirmed. Waiting for someone to fulfill the issue.";
      case "claimed":
        return bounty.claimedBy 
          ? `Claimed by ${bounty.claimedBy.slice(0, 8)}... on ${formatDate24h(bounty.claimedAt || 0)}`
          : "Claimed - waiting for fulfillment";
      case "released":
        return bounty.releasedAt
          ? `Released on ${formatDate24h(bounty.releasedAt)}`
          : "Released to contributor";
      default:
        return "";
    }
  };

  return (
    <div className="p-6">
      <SettingsHero title="My Bounties" />
      
      <div className="mt-6">
        <p className="text-sm text-gray-400 mb-4">
          Track all bounties you've offered on issues. You'll be notified when someone claims or fulfills them.
        </p>
        
        {bounties.length === 0 ? (
          <div className="p-8 border border-gray-700 rounded text-center">
            <Coins className="h-12 w-12 mx-auto mb-4 text-gray-500" />
            <p className="text-gray-400">No bounties offered yet</p>
            <p className="text-sm text-gray-500 mt-2">
              Add a bounty to any issue to incentivize contributors
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {bounties.map((bounty) => {
              const [entity, repo] = bounty.repoId.split("/");
              return (
                <div key={bounty.issueId} className="p-4 border border-gray-700 rounded bg-gray-900">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Coins className="h-4 w-4 text-yellow-400" />
                        <Link 
                          href={`/${entity}/${repo}/issues/${bounty.issueId}`}
                          className="font-semibold hover:text-purple-400"
                        >
                          {bounty.issueTitle}
                        </Link>
                        {getStatusBadge(bounty.status)}
                      </div>
                      <div className="text-sm text-gray-400">
                        <Link 
                          href={`/${entity}/${repo}`}
                          className="hover:text-purple-400"
                        >
                          {bounty.repoId}
                        </Link>
                        {" • "}
                        <span className="text-green-400 font-medium">{bounty.amount} sats</span>
                        {" • "}
                        {formatDate24h(bounty.createdAt)}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {getStatusDescription(bounty)}
                      </p>
                    </div>
                  </div>
                  {bounty.claimedBy && bounty.status === "claimed" && (
                    <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-700 rounded text-sm">
                      <p className="text-yellow-200">
                        <strong>Claimed by:</strong>{" "}
                        <Link href={`/${bounty.claimedBy}`} className="hover:text-purple-400">
                          {bounty.claimedBy.slice(0, 8)}...
                        </Link>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        When they merge a PR that fixes this issue, the bounty will be automatically released.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

