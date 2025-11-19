"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { ZapRecord, getZapHistory } from "@/lib/payments/zap-tracker";
import { Zap, Wallet, TrendingUp, Clock, CheckCircle2, XCircle } from "lucide-react";
import { nip19 } from "nostr-tools";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface WalletBalance {
  label: string;
  type: "lnbits_send" | "lnbits_recv" | "nwc_send";
  balance?: number;
  loading: boolean;
  error?: string;
}

export default function ZapsPage() {
  const { isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();
  const [zaps, setZaps] = useState<ZapRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending" | "failed">("all");
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([]);

  // Calculate zap statistics
  const zapStats = useMemo(() => {
    const stats = {
      total: zaps.length,
      paid: zaps.filter(z => z.status === "paid").length,
      pending: zaps.filter(z => z.status === "pending").length,
      failed: zaps.filter(z => z.status === "failed").length,
      totalPaid: zaps.filter(z => z.status === "paid").reduce((sum, z) => sum + z.amount, 0),
      totalPending: zaps.filter(z => z.status === "pending").reduce((sum, z) => sum + z.amount, 0),
      totalFailed: zaps.filter(z => z.status === "failed").reduce((sum, z) => sum + z.amount, 0),
    };
    return stats;
  }, [zaps]);

  // Helper to normalize pubkey/npub for comparison (synchronous)
  const normalizePubkey = (key: string): string => {
    if (!key) return "";
    try {
      // If it's an npub, decode it
      if (key.startsWith("npub")) {
        const decoded = nip19.decode(key);
        return (decoded.data as string).toLowerCase();
      }
      // If it's already a hex pubkey, normalize case
      if (/^[0-9a-f]{64}$/i.test(key)) {
        return key.toLowerCase();
      }
      return key.toLowerCase();
    } catch {
      // If decoding fails, try to use as-is (might be hex already)
      return key.toLowerCase();
    }
  };

  // Load zap history
  useEffect(() => {
    if (!isLoggedIn) return;
    
    try {
      const allZaps = getZapHistory(undefined, undefined, 500);
      
      // Filter by sent/received if user pubkey is available
      if (pubkey) {
        const normalizedPubkey = normalizePubkey(pubkey);
        let filtered = allZaps;
        
        if (filter === "sent") {
          // Filter zaps where sender matches current user
          filtered = allZaps.filter(z => {
            if (!z.sender) return false;
            const normalizedSender = normalizePubkey(z.sender);
            return normalizedSender === normalizedPubkey;
          });
          console.log("Zaps filtered (sent):", { 
            total: allZaps.length, 
            filtered: filtered.length, 
            pubkey: normalizedPubkey.slice(0, 8) 
          });
        } else if (filter === "received") {
          // Filter zaps where recipient matches current user
          filtered = allZaps.filter(z => {
            const normalizedRecipient = normalizePubkey(z.recipient);
            return normalizedRecipient === normalizedPubkey;
          });
          console.log("Zaps filtered (received):", { 
            total: allZaps.length, 
            filtered: filtered.length, 
            pubkey: normalizedPubkey.slice(0, 8) 
          });
        } else {
          // "all" - show all zaps
          console.log("Zaps (all):", { total: allZaps.length });
        }
        setZaps(filtered);
      } else {
        setZaps(allZaps);
      }
    } catch (error) {
      console.error("Failed to load zaps:", error);
      setZaps([]);
    }
  }, [isLoggedIn, pubkey, filter]);

  // Load wallet balances
  useEffect(() => {
    if (!isLoggedIn) return;

    const loadBalances = async () => {
      const balances: WalletBalance[] = [];
      
      // LNbits sending wallet
      const lnbitsUrl = localStorage.getItem("gittr_lnbits_url");
      const lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key");
      if (lnbitsUrl && lnbitsAdminKey) {
        balances.push({ label: "LNbits (Sending)", type: "lnbits_send", loading: true });
        
        try {
          const response = await fetch("/api/balance/lnbits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lnbitsUrl, lnbitsAdminKey }),
          });
          const data = await response.json();
          
          if (data.status === "ok") {
            balances[balances.length - 1] = {
              label: "LNbits (Sending)",
              type: "lnbits_send",
              balance: data.balanceSats || data.balance,
              loading: false,
            };
          } else {
            balances[balances.length - 1] = {
              label: "LNbits (Sending)",
              type: "lnbits_send",
              loading: false,
              error: data.message || "Failed to fetch balance",
            };
          }
        } catch (error: any) {
          balances[balances.length - 1] = {
            label: "LNbits (Sending)",
            type: "lnbits_send",
            loading: false,
            error: error.message || "Connection error",
          };
        }
      }
      
      // LNbits receiving wallet (if different - for now assume same)
      // Could be extended to support separate receiving wallet
      
      // NWC sending wallet
      const nwcSend = localStorage.getItem("gittr_nwc_send");
      if (nwcSend) {
        balances.push({ label: "NWC (Sending)", type: "nwc_send", loading: true });
        
        try {
          // NWC balance is checked client-side
          const { getNWCBalance } = await import("@/lib/payments/nwc-balance");
          const result = await getNWCBalance(nwcSend);
          
          if (result.balanceSats !== undefined || result.balance !== undefined) {
            balances[balances.length - 1] = {
              label: "NWC (Sending)",
              type: "nwc_send",
              balance: result.balanceSats || (result.balance ? Math.floor(result.balance / 1000) : 0),
              loading: false,
            };
          } else {
            balances[balances.length - 1] = {
              label: "NWC (Sending)",
              type: "nwc_send",
              loading: false,
              error: "Balance not available",
            };
          }
        } catch (error: any) {
          balances[balances.length - 1] = {
            label: "NWC (Sending)",
            type: "nwc_send",
            loading: false,
            error: error.message || "Connection error",
          };
        }
      }
      
      setWalletBalances(balances);
    };

    loadBalances();
  }, [isLoggedIn]);

  const getZapTypeLabel = (type: string) => {
    switch (type) {
      case "repo": return "Repository";
      case "issue": return "Issue";
      case "pr": return "Pull Request";
      case "user": return "User";
      default: return "Zap";
    }
  };

  const getZapContextLink = (zap: ZapRecord) => {
    if (!zap.contextId) return null;
    
    if (zap.type === "repo") {
      return `/${zap.contextId}`;
    } else if (zap.type === "issue" || zap.type === "pr") {
      const [entity, repo, type, id] = zap.contextId.split("/");
      return `/${entity}/${repo}/${type === "issues" ? "issues" : "pulls"}/${id}`;
    }
    return null;
  };

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Zaps</h1>
        <p className="text-gray-400">Please sign in to view your zap history.</p>
      </div>
    );
  }

  // Filter zaps by status and exclude deleted repos
  const filteredZaps = useMemo(() => {
    // Helper function to check if a repo is deleted
    const isRepoDeleted = (contextId: string): boolean => {
      if (!contextId) return false;
      
      try {
        // Load list of locally-deleted repos
        const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
        const deletedReposSet = new Set(deletedRepos.map(d => `${d.entity}/${d.repo}`.toLowerCase()));
        
        // For repo zaps, contextId is "entity/repo"
        if (contextId.includes("/")) {
          const repoKey = contextId.toLowerCase();
          if (deletedReposSet.has(repoKey)) return true;
          
          // Also check if repo exists and is marked as deleted
          const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
          const [entity, repoName] = contextId.split("/");
          const repo = repos.find((r: any) => {
            const rEntity = r.entity || "";
            const rRepo = r.repo || r.slug || "";
            return rEntity.toLowerCase() === (entity || "").toLowerCase() &&
                   rRepo.toLowerCase() === (repoName || "").toLowerCase();
          });
          
          if (repo && (repo.deleted === true || repo.archived === true)) {
            return true;
          }
        }
        
        return false;
      } catch {
        return false;
      }
    };
    
    let filtered = zaps;
    
    // Filter out zaps for deleted repos
    filtered = filtered.filter(z => {
      // Only filter repo-type zaps (issues/PRs might still be valid even if repo is deleted)
      if (z.type === "repo" && z.contextId) {
        return !isRepoDeleted(z.contextId);
      }
      return true; // Keep non-repo zaps and zaps without contextId
    });
    
    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter(z => z.status === statusFilter);
    }
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [zaps, statusFilter]);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-purple-500" />
          Your Zaps
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded text-sm ${
              filter === "all" ? "bg-purple-600 text-white" : "border border-purple-500 text-purple-400"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("sent")}
            className={`px-4 py-2 rounded text-sm ${
              filter === "sent" ? "bg-purple-600 text-white" : "border border-purple-500 text-purple-400"
            }`}
          >
            Sent
          </button>
          <button
            onClick={() => setFilter("received")}
            className={`px-4 py-2 rounded text-sm ${
              filter === "received" ? "bg-purple-600 text-white" : "border border-purple-500 text-purple-400"
            }`}
          >
            Received
          </button>
        </div>
      </div>

      {/* Wallet Balances */}
      {walletBalances.length > 0 && (
        <div className="border border-[#383B42] rounded p-4 mb-6 bg-[#171B21]">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-purple-400" />
            Wallet Balances
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {walletBalances.map((wallet, idx) => (
              <div key={idx} className="border border-[#383B42] rounded p-3">
                <div className="text-sm text-gray-400 mb-1">{wallet.label}</div>
                {wallet.loading ? (
                  <div className="text-gray-500 text-sm">Loading...</div>
                ) : wallet.error ? (
                  <div className="text-red-400 text-sm">{wallet.error}</div>
                ) : (
                  <div className="text-xl font-bold text-purple-400">
                    {wallet.balance?.toLocaleString() || 0} sats
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zap Statistics */}
      {zaps.length > 0 && (
        <div className="border border-[#383B42] rounded p-4 mb-6 bg-[#171B21]">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-400" />
            Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 theme-accent-secondary" />
                Paid
              </div>
              <div className="text-xl font-bold theme-accent-secondary">{zapStats.totalPaid.toLocaleString()} sats</div>
              <div className="text-xs text-gray-500">{zapStats.paid} zaps</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
                <Clock className="h-4 w-4 text-yellow-400" />
                Pending
              </div>
              <div className="text-xl font-bold text-yellow-400">{zapStats.totalPending.toLocaleString()} sats</div>
              <div className="text-xs text-gray-500">{zapStats.pending} zaps</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
                <XCircle className="h-4 w-4 text-red-400" />
                Failed
              </div>
              <div className="text-xl font-bold text-red-400">{zapStats.totalFailed.toLocaleString()} sats</div>
              <div className="text-xs text-gray-500">{zapStats.failed} zaps</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Total</div>
              <div className="text-xl font-bold text-purple-400">{zapStats.total} zaps</div>
              <div className="text-xs text-gray-500">{(zapStats.totalPaid + zapStats.totalPending + zapStats.totalFailed).toLocaleString()} sats</div>
            </div>
          </div>
          
          {/* Status Filter */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "all" ? "bg-purple-600 text-white" : "border border-purple-500 text-purple-400"
              }`}
            >
              All ({zapStats.total})
            </button>
            <button
              onClick={() => setStatusFilter("paid")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "paid" ? "theme-bg-accent-primary text-white" : "border border-purple-500 text-purple-400"
              }`}
            >
              Paid ({zapStats.paid})
            </button>
            <button
              onClick={() => setStatusFilter("pending")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "pending" ? "bg-yellow-600 text-white" : "border border-yellow-500 text-yellow-400"
              }`}
            >
              Pending ({zapStats.pending})
            </button>
            <button
              onClick={() => setStatusFilter("failed")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "failed" ? "bg-red-600 text-white" : "border border-red-500 text-red-400"
              }`}
            >
              Failed ({zapStats.failed})
            </button>
          </div>
        </div>
      )}

      {filteredZaps.length === 0 ? (
        <div className="border border-[#383B42] rounded p-8 text-center">
          <Zap className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">
            {zaps.length === 0 
              ? "No zaps found." 
              : `No ${statusFilter === "all" ? "" : statusFilter + " "}zaps found.`}
          </p>
          {zaps.length === 0 && (
            <Link href="/explore">
              <button className="mt-4 px-4 py-2 border border-purple-500 text-purple-400 rounded hover:bg-purple-900/20">
                Explore Repositories
              </button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredZaps.map((zap) => {
              const contextLink = getZapContextLink(zap);
              const statusColor = zap.status === "paid" ? "text-green-400" : zap.status === "pending" ? "text-yellow-400" : "text-red-400";
              
              return (
                <div
                  key={zap.id}
                  className="border border-[#383B42] rounded p-4 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className="h-4 w-4 text-purple-400" />
                        <span className="font-semibold text-purple-400">{zap.amount} sats</span>
                        <span className="text-gray-500">•</span>
                        <span className="text-sm text-gray-400">{getZapTypeLabel(zap.type)}</span>
                        <span className={`text-xs ${statusColor}`}>
                          {zap.status === "paid" ? "✓ Paid" : zap.status === "pending" ? "⏳ Pending" : "✗ Failed"}
                        </span>
                      </div>
                      {zap.comment && (
                        <p className="text-sm text-gray-300 mb-1">{zap.comment}</p>
                      )}
                      {zap.contextId && contextLink && (
                        <Link href={contextLink} className="text-sm text-purple-400 hover:underline">
                          {zap.contextId}
                        </Link>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {formatDateTime24h(zap.createdAt * 1000)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

