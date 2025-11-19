"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { ZapRecord, getZapHistory } from "@/lib/payments/zap-tracker";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Zap, Heart, TrendingUp, Package, Coins } from "lucide-react";
import { nip19 } from "nostr-tools";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface SponsorStats {
  sender: string; // pubkey/npub of sponsor
  totalAmount: number; // Total sats zapped
  zapCount: number; // Number of zaps
  repos: Array<{
    repoId: string; // entity/repo format
    repoName?: string; // Display name
    amount: number; // Total zapped for this repo
    count: number; // Number of zaps for this repo
  }>;
  firstZap: number; // Timestamp of first zap
  lastZap: number; // Timestamp of last zap
}

interface BountyReceived {
  withdrawUrl: string; // Shareable URL to claim the bounty
  withdrawId: string; // Withdraw link ID
  issueId: string;
  issueTitle: string;
  repoId: string; // entity/repo format
  repoName?: string;
  amount: number;
  from: string; // Bounty creator pubkey
  earnedAt: number; // Timestamp when PR was merged (bounty earned)
  status: "unredeemed" | "redeemed"; // Status of the withdraw link
}

export default function SponsorsPage() {
  const { isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();
  const [sponsors, setSponsors] = useState<SponsorStats[]>([]);
  const [bountiesReceived, setBountiesReceived] = useState<BountyReceived[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to normalize pubkey/npub for comparison
  const normalizePubkey = (key: string): string => {
    if (!key) return "";
    try {
      if (key.startsWith("npub")) {
        const decoded = nip19.decode(key);
        return (decoded.data as string).toLowerCase();
      }
      if (/^[0-9a-f]{64}$/i.test(key)) {
        return key.toLowerCase();
      }
      return key.toLowerCase();
    } catch {
      return key.toLowerCase();
    }
  };

  // Get unique sponsor pubkeys for metadata fetching - normalize to full pubkeys
  const sponsorPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    for (const sponsor of sponsors) {
      if (!sponsor.sender) continue;
      const normalized = normalizePubkey(sponsor.sender);
      if (normalized && /^[0-9a-f]{64}$/i.test(normalized)) {
        pubkeys.add(normalized);
      }
    }
    return Array.from(pubkeys);
  }, [sponsors]);

  const sponsorMetadata = useContributorMetadata(sponsorPubkeys);

  // Load and process sponsor data and earned bounties
  useEffect(() => {
    if (!isLoggedIn || !pubkey) {
      setLoading(false);
      return;
    }

    try {
      const allZaps = getZapHistory(undefined, undefined, 1000);
      const normalizedPubkey = normalizePubkey(pubkey);

      // Filter zaps where current user is the recipient
      const receivedZaps = allZaps.filter(z => {
        const normalizedRecipient = normalizePubkey(z.recipient);
        return normalizedRecipient === normalizedPubkey;
      });

      // Group by sender
      const sponsorMap = new Map<string, {
        zaps: ZapRecord[];
        sender: string;
      }>();

      for (const zap of receivedZaps) {
        if (!zap.sender) continue; // Skip zaps without sender info
        
        const normalizedSender = normalizePubkey(zap.sender);
        const existing = sponsorMap.get(normalizedSender);
        
        if (existing) {
          existing.zaps.push(zap);
        } else {
          sponsorMap.set(normalizedSender, {
            zaps: [zap],
            sender: zap.sender, // Keep original format for display
          });
        }
      }

      // Convert to SponsorStats array
      const sponsorStats: SponsorStats[] = Array.from(sponsorMap.entries()).map(([normalizedSender, data]) => {
        const zaps = data.zaps;
        
        // Group zaps by repo (contextId)
        const repoMap = new Map<string, ZapRecord[]>();
        for (const zap of zaps) {
          if (zap.contextId && zap.type === "repo") {
            const repoId = zap.contextId;
            const existing = repoMap.get(repoId) || [];
            existing.push(zap);
            repoMap.set(repoId, existing);
          }
        }

        // Build repo stats
        const repos = Array.from(repoMap.entries()).map(([repoId, repoZaps]) => {
          const totalAmount = repoZaps.reduce((sum, z) => sum + z.amount, 0);
          return {
            repoId,
            repoName: repoId.split("/").pop() || repoId,
            amount: totalAmount,
            count: repoZaps.length,
          };
        }).sort((a, b) => b.amount - a.amount); // Sort by amount descending

        const timestamps = zaps.map(z => z.createdAt * 1000).sort((a, b) => a - b);

        return {
          sender: data.sender,
          totalAmount: zaps.reduce((sum, z) => sum + z.amount, 0),
          zapCount: zaps.length,
          repos,
          firstZap: timestamps[0] || Date.now(),
          lastZap: timestamps[timestamps.length - 1] || Date.now(),
        };
      });

      // Sort by total amount (highest first)
      sponsorStats.sort((a, b) => b.totalAmount - a.totalAmount);

      setSponsors(sponsorStats);

      // Load earned bounties
      const earnedBounties: BountyReceived[] = JSON.parse(localStorage.getItem("gittr_earned_bounties") || "[]");

      // Immediately show what we have so the section renders without waiting on status checks
      if (earnedBounties && earnedBounties.length > 0) {
        setBountiesReceived(earnedBounties);
      }

      // Check status of each bounty (redeemed/unredeemed) - async helper
      (async () => {
        try {
          // Get LNbits invoice key from localStorage for status checks
          const lnbitsInvoiceKey = typeof window !== "undefined" ? localStorage.getItem("gittr_lnbits_invoice_key") : null;
          const lnbitsUrl = typeof window !== "undefined" ? localStorage.getItem("gittr_lnbits_url") || "https://bitcoindelta.club" : "https://bitcoindelta.club";
          
          // Check status of each bounty (redeemed/unredeemed)
          // Sort: unredeemed first, then by date (newest first)
          const bountiesWithStatus = await Promise.all(
            earnedBounties.map(async (bounty) => {
              // Check if withdraw link is used/redeemed
              // We'll check this by calling an API endpoint
              try {
                const params = new URLSearchParams({
                  withdrawId: bounty.withdrawId,
                  ...(lnbitsInvoiceKey ? { lnbitsInvoiceKey } : {}),
                  ...(lnbitsUrl ? { lnbitsUrl } : {}),
                });
                const response = await fetch(`/api/bounty/check-withdraw?${params}`);
                if (response.ok) {
                  const data = await response.json();
                  return { ...bounty, status: data.used ? "redeemed" as const : "unredeemed" as const };
                }
              } catch (error) {
                console.error("Failed to check withdraw status:", error);
              }
              return bounty; // Default to stored status
            })
          );

          // Sort: unredeemed first, then by date (newest first)
          bountiesWithStatus.sort((a, b) => {
            if (a.status === "unredeemed" && b.status === "redeemed") return -1;
            if (a.status === "redeemed" && b.status === "unredeemed") return 1;
            return b.earnedAt - a.earnedAt; // Newest first
          });

          setBountiesReceived(bountiesWithStatus);
        } catch (error) {
          console.error("Failed to check bounty statuses:", error);
          // Fallback: just set bounties without status check
          setBountiesReceived(earnedBounties);
        }
      })();
    } catch (error) {
      console.error("Failed to load sponsors:", error);
      setSponsors([]);
      setBountiesReceived([]);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, pubkey]);

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Sponsors & Bounties</h1>
        <p className="text-gray-400">Please sign in to view your sponsors and bounties received.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Sponsors & Bounties</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  const totalReceived = sponsors.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalZaps = sponsors.reduce((sum, s) => sum + s.zapCount, 0);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Heart className="h-6 w-6 text-purple-500" />
          Sponsors & Bounties
        </h1>
      </div>

      {sponsors.length === 0 ? (
        <div className="border border-[#383B42] rounded p-8 text-center">
          <Heart className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">No sponsors yet.</p>
          <p className="text-gray-500 text-sm mb-4">
            Sponsors are users who have zapped you. Share your repositories to get zapped!
          </p>
          <Link href="/explore">
            <button className="mt-4 px-4 py-2 border border-purple-500 text-purple-400 rounded hover:bg-purple-900/20">
              Explore Repositories
            </button>
          </Link>
        </div>
      ) : (
        <>
          {/* Summary Statistics */}
          <div className="border border-[#383B42] rounded p-4 mb-6 bg-[#171B21]">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-400" />
              Summary
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">Total Sponsors</div>
                <div className="text-2xl font-bold text-purple-400">{sponsors.length}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Total Received</div>
                <div className="text-2xl font-bold theme-accent-secondary">{totalReceived.toLocaleString()} sats</div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Total Zaps</div>
                <div className="text-2xl font-bold text-yellow-400">{totalZaps}</div>
              </div>
            </div>
          </div>

          {/* Bounties Received Section */}
          {bountiesReceived.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Coins className="h-5 w-5 text-yellow-400" />
                Bounties Earned ({bountiesReceived.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {bountiesReceived.map((bounty, index) => {
                  const [entity, repoName] = bounty.repoId.split("/");
                  const repoLink = `/${bounty.repoId}`;
                  const issueLink = `/${bounty.repoId}/issues/${bounty.issueId}`;
                  const isRedeemed = bounty.status === "redeemed";
                  
                  return (
                    <div
                      key={`${bounty.withdrawId}-${bounty.issueId}`}
                      className={`border ${isRedeemed ? "border-gray-600" : "border-yellow-500/50"} rounded p-4 hover:bg-white/5 transition-colors ${isRedeemed ? "opacity-60" : ""}`}
                    >
                      <div className="flex flex-col h-full">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-lg font-bold ${isRedeemed ? "text-gray-400" : "text-yellow-400"}`}>
                            {bounty.amount.toLocaleString()} sats
                          </span>
                          {isRedeemed ? (
                            <span className="text-xs bg-gray-600 text-gray-300 px-2 py-1 rounded">Redeemed</span>
                          ) : (
                            <span className="text-xs bg-yellow-600 text-yellow-100 px-2 py-1 rounded">Unredeemed</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-300 mb-1 flex-1">
                          <Link href={issueLink} className="hover:text-purple-400 hover:underline line-clamp-2">
                            {bounty.issueTitle}
                          </Link>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          <Link href={repoLink} className="hover:text-purple-400">
                            {bounty.repoName || bounty.repoId}
                          </Link>
                          {" • "}
                          {formatDate24h(bounty.earnedAt)}
                        </div>
                        {!isRedeemed && bounty.withdrawUrl && (
                          <a
                            href={bounty.withdrawUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-2 mt-auto px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded transition-colors"
                          >
                            <Coins className="h-4 w-4" />
                            Claim Bounty
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sponsors List */}
          <div className="space-y-4">
            {sponsors.map((sponsor) => {
              const normalizedSender = normalizePubkey(sponsor.sender);
              // Use lowercase for metadata lookup (metadata is stored in lowercase)
              const normalizedKey = normalizedSender && /^[0-9a-f]{64}$/i.test(normalizedSender)
                ? normalizedSender.toLowerCase()
                : null;
              // Use normalized pubkey for metadata lookup
              const metadata = normalizedKey
                ? (sponsorMetadata[normalizedKey] || sponsorMetadata[normalizedSender] || {})
                : {};
              // Never show shortened pubkey - use npub or full pubkey as last resort
              const displayName = metadata.name || metadata.display_name || (normalizedKey ? (() => {
                try {
                  return nip19.npubEncode(normalizedKey).substring(0, 16) + "...";
                } catch {
                  return normalizedKey.substring(0, 16) + "...";
                }
              })() : "Unknown");
              const picture = metadata.picture;
              const profileLink = normalizedKey && /^[0-9a-f]{64}$/i.test(normalizedKey)
                ? (() => {
                    try {
                      return `/${nip19.npubEncode(normalizedKey)}`;
                    } catch {
                      return `/${normalizedKey}`;
                    }
                  })()
                : null;

              return (
                <div
                  key={sponsor.sender}
                  className="border border-[#383B42] rounded p-6 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Sponsor Avatar */}
                    <div className="flex-shrink-0">
                      {profileLink ? (
                        <Link href={profileLink}>
                          <Avatar className="h-12 w-12 cursor-pointer">
                            <AvatarImage src={picture || undefined} alt={displayName} />
                            <AvatarFallback className="bg-gray-700 text-white">
                              {displayName.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </Link>
                      ) : (
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={picture || undefined} alt={displayName} />
                          <AvatarFallback className="bg-gray-700 text-white">
                            {displayName.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>

                    {/* Sponsor Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          {profileLink ? (
                            <Link href={profileLink} className="text-purple-400 hover:underline font-semibold">
                              {displayName}
                            </Link>
                          ) : (
                            <span className="text-purple-400 font-semibold">{displayName}</span>
                          )}
                          {metadata.nip05 && (
                            <span className="text-gray-500 text-sm ml-2">@{metadata.nip05}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-purple-400">{sponsor.totalAmount.toLocaleString()} sats</div>
                          <div className="text-xs text-gray-500">{sponsor.zapCount} zap{sponsor.zapCount !== 1 ? "s" : ""}</div>
                        </div>
                      </div>

                      {/* Repo Breakdown */}
                      {sponsor.repos.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm text-gray-400 flex items-center gap-1">
                            <Package className="h-4 w-4" />
                            Repositories Zapped:
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {sponsor.repos.map((repo) => {
                              const [entity, repoName] = repo.repoId.split("/");
                              const repoLink = repo.repoId ? `/${repo.repoId}` : null;
                              
                              return (
                                <div
                                  key={repo.repoId}
                                  className="border border-purple-500/30 rounded px-3 py-1 bg-purple-900/20"
                                >
                                  {repoLink ? (
                                    <Link href={repoLink} className="flex items-center gap-2 hover:text-purple-300">
                                      <span className="text-purple-400">{repo.repoName || repo.repoId}</span>
                                      <span className="text-xs text-gray-500">
                                        ({repo.amount.toLocaleString()} sats, {repo.count}x)
                                      </span>
                                    </Link>
                                  ) : (
                                    <span className="text-purple-400">
                                      {repo.repoName || repo.repoId} ({repo.amount.toLocaleString()} sats, {repo.count}x)
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Timeline */}
                      <div className="mt-2 text-xs text-gray-500">
                        First zap: {formatDate24h(sponsor.firstZap)} • 
                        Last zap: {formatDate24h(sponsor.lastZap)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

