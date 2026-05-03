"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_ZAP } from "@/lib/nostr/events";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import useSession from "@/lib/nostr/useSession";
import {
  type ZapRecord,
  getZapHistory,
  zapReceipt9735ToRecord,
} from "@/lib/payments/zap-tracker";
import { formatDateTime24h } from "@/lib/utils/date-format";

import {
  CheckCircle2,
  Clock,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { type Event, type Filter, nip19 } from "nostr-tools";

/** Repo zaps only: hide rows for repos the user deleted locally or archived. */
function isRepoDeletedContext(contextId: string): boolean {
  if (typeof window === "undefined" || !contextId) return false;
  try {
    const deletedRepos = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as Array<{ entity: string; repo: string; deletedAt: number }>;
    const deletedReposSet = new Set(
      deletedRepos.map((d) => `${d.entity}/${d.repo}`.toLowerCase())
    );

    if (contextId.includes("/")) {
      const repoKey = contextId.toLowerCase();
      if (deletedReposSet.has(repoKey)) return true;

      const repos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      ) as any[];
      const [entity, repoName] = contextId.split("/");
      const repo = repos.find((r: any) => {
        const rEntity = r.entity || "";
        const rRepo = r.repo || r.slug || "";
        return (
          rEntity.toLowerCase() === (entity || "").toLowerCase() &&
          rRepo.toLowerCase() === (repoName || "").toLowerCase()
        );
      });
      if (repo && (repo.deleted === true || repo.archived === true)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function dropLocalPendingIfNip57Receipt(
  local: ZapRecord,
  nip57Rows: ZapRecord[],
  norm: (k: string) => string
): boolean {
  if (local.source === "nip57") return false;
  if (local.status !== "pending") return false;
  for (const n of nip57Rows) {
    if (n.source !== "nip57") continue;
    if (norm(local.recipient) !== norm(n.recipient)) continue;
    if (local.sender && n.sender && norm(local.sender) !== norm(n.sender)) {
      continue;
    }
    if (Math.abs(local.amount - n.amount) > 1) continue;
    if (Math.abs(local.createdAt - n.createdAt) > 20 * 60 * 1000) continue;
    if (local.contextId && n.contextId && local.contextId !== n.contextId) {
      continue;
    }
    return true;
  }
  return false;
}

interface WalletBalance {
  label: string;
  type: "lnbits_send" | "lnbits_recv" | "nwc_send";
  balance?: number;
  loading: boolean;
  error?: string;
}

export default function ZapsPage() {
  const { isLoggedIn } = useSession();
  const { pubkey, subscribe, defaultRelays } = useNostrContext();
  const [zaps, setZaps] = useState<ZapRecord[]>([]);
  const [nip57Receipts, setNip57Receipts] = useState<Event[]>([]);
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "paid" | "pending" | "failed"
  >("all");
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([]);
  const [mounted, setMounted] = useState(false);

  // Helper to normalize pubkey/npub for comparison (synchronous)
  const normalizePubkey = useCallback((key: string): string => {
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
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter zaps by status and exclude deleted repos
  // NOTE: This useMemo must be called BEFORE any early returns to follow React's rules of hooks
  const filteredZaps = useMemo(() => {
    if (!mounted || typeof window === "undefined") {
      return [];
    }

    let filtered = zaps;

    // Filter out zaps for deleted repos
    filtered = filtered.filter((z) => {
      // Only filter repo-type zaps (issues/PRs might still be valid even if repo is deleted)
      if (z.type === "repo" && z.contextId) {
        return !isRepoDeletedContext(z.contextId);
      }
      return true; // Keep non-repo zaps and zaps without contextId
    });

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((z) => z.status === statusFilter);
    }
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [zaps, statusFilter, mounted]);

  const nip57AsRecords = useMemo(() => {
    return nip57Receipts
      .map((ev) => zapReceipt9735ToRecord(ev))
      .filter((r): r is ZapRecord => r !== null);
  }, [nip57Receipts]);

  /** NIP-57 rows for current sent/received tab, excluding deleted-repo targets */
  const nip57Scoped = useMemo(() => {
    if (!mounted || typeof window === "undefined" || !pubkey) return [];
    const norm = normalizePubkey;
    const me = norm(pubkey);
    let rows = nip57AsRecords;
    if (filter === "sent") {
      rows = rows.filter((z) => {
        if (!z.sender) return false;
        return norm(z.sender) === me;
      });
    } else if (filter === "received") {
      rows = rows.filter((z) => norm(z.recipient) === me);
    }
    return rows.filter((z) => {
      if (z.type === "repo" && z.contextId) {
        return !isRepoDeletedContext(z.contextId);
      }
      return true;
    });
  }, [nip57AsRecords, pubkey, filter, mounted, normalizePubkey]);

  const nip57VisibleByStatus = useMemo(() => {
    if (statusFilter === "pending" || statusFilter === "failed") return [];
    return nip57Scoped;
  }, [nip57Scoped, statusFilter]);

  const displayZaps = useMemo(() => {
    const nip = nip57VisibleByStatus;
    const locals = filteredZaps.filter(
      (z) => !dropLocalPendingIfNip57Receipt(z, nip, normalizePubkey)
    );
    const merged = [...locals, ...nip];
    merged.sort((a, b) => b.createdAt - a.createdAt);
    const seen = new Set<string>();
    return merged.filter((z) => {
      if (seen.has(z.id)) return false;
      seen.add(z.id);
      return true;
    });
  }, [filteredZaps, nip57VisibleByStatus, normalizePubkey]);

  const zapStats = useMemo(() => {
    const paidGittr = zaps.filter((z) => z.status === "paid");
    const pendingGittr = zaps.filter((z) => z.status === "pending");
    const failedGittr = zaps.filter((z) => z.status === "failed");
    const nipPaid = nip57Scoped;
    const paidCount = paidGittr.length + nipPaid.length;
    const totalPaidSats =
      paidGittr.reduce((sum, z) => sum + z.amount, 0) +
      nipPaid.reduce((sum, z) => sum + z.amount, 0);
    return {
      total: zaps.length + nipPaid.length,
      paid: paidCount,
      pending: pendingGittr.length,
      failed: failedGittr.length,
      totalPaid: totalPaidSats,
      totalPending: pendingGittr.reduce((sum, z) => sum + z.amount, 0),
      totalFailed: failedGittr.reduce((sum, z) => sum + z.amount, 0),
    };
  }, [zaps, nip57Scoped]);

  // Load zap history
  useEffect(() => {
    if (!mounted || !isLoggedIn || typeof window === "undefined") return;

    try {
      const allZaps = getZapHistory(undefined, undefined, 500);

      // Filter by sent/received if user pubkey is available
      if (pubkey) {
        const normalizedPubkey = normalizePubkey(pubkey);
        let filtered = allZaps;

        if (filter === "sent") {
          // Filter zaps where sender matches current user
          filtered = allZaps.filter((z) => {
            if (!z.sender) return false;
            const normalizedSender = normalizePubkey(z.sender);
            return normalizedSender === normalizedPubkey;
          });
          console.log("Zaps filtered (sent):", {
            total: allZaps.length,
            filtered: filtered.length,
            pubkey: normalizedPubkey.slice(0, 8),
          });
        } else if (filter === "received") {
          // Filter zaps where recipient matches current user
          filtered = allZaps.filter((z) => {
            const normalizedRecipient = normalizePubkey(z.recipient);
            return normalizedRecipient === normalizedPubkey;
          });
          console.log("Zaps filtered (received):", {
            total: allZaps.length,
            filtered: filtered.length,
            pubkey: normalizedPubkey.slice(0, 8),
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
  }, [mounted, isLoggedIn, pubkey, filter]);

  // Live NIP-57 zap receipts (kind 9735) from relays — merged into the list above
  useEffect(() => {
    if (!mounted || !isLoggedIn || !pubkey || !subscribe) return;
    setNip57Receipts([]);
    const hex = normalizePubkey(pubkey);
    const relays = getAllRelays(defaultRelays);
    const filters: Filter[] =
      filter === "all"
        ? [
            { kinds: [KIND_ZAP], "#p": [hex], limit: 500 },
            { kinds: [KIND_ZAP], "#P": [hex], limit: 500 },
          ]
        : filter === "received"
        ? [{ kinds: [KIND_ZAP], "#p": [hex], limit: 500 }]
        : [{ kinds: [KIND_ZAP], "#P": [hex], limit: 500 }];

    const collected = new Map<string, Event>();
    const unsub = subscribe(
      filters,
      relays,
      (event) => {
        if (event.kind !== KIND_ZAP) return;
        collected.set(event.id, event as Event);
        setNip57Receipts(Array.from(collected.values()));
      },
      undefined,
      undefined,
      {}
    );
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [
    mounted,
    isLoggedIn,
    pubkey,
    subscribe,
    defaultRelays,
    filter,
    normalizePubkey,
  ]);

  // Load wallet balances
  useEffect(() => {
    if (!isLoggedIn) return;

    const loadBalances = async () => {
      if (typeof window === "undefined") return;

      const balances: WalletBalance[] = [];

      // LNbits sending wallet
      const lnbitsUrl = localStorage.getItem("gittr_lnbits_url");
      const lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key");
      if (lnbitsUrl && lnbitsAdminKey) {
        balances.push({
          label: "LNbits (Sending)",
          type: "lnbits_send",
          loading: true,
        });

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
      const nwcSend =
        typeof window !== "undefined"
          ? localStorage.getItem("gittr_nwc_send")
          : null;
      if (nwcSend) {
        balances.push({
          label: "NWC (Sending)",
          type: "nwc_send",
          loading: true,
        });

        try {
          // NWC balance is checked client-side
          const { getNWCBalance } = await import("@/lib/payments/nwc-balance");
          const result = await getNWCBalance(nwcSend);

          if (
            result.balanceSats !== undefined ||
            result.balance !== undefined
          ) {
            balances[balances.length - 1] = {
              label: "NWC (Sending)",
              type: "nwc_send",
              balance:
                result.balanceSats ||
                (result.balance ? Math.floor(result.balance / 1000) : 0),
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
      case "repo":
        return "Repository";
      case "issue":
        return "Issue";
      case "pr":
        return "Pull Request";
      case "user":
        return "User";
      default:
        return "Zap";
    }
  };

  const getZapContextLink = (zap: ZapRecord) => {
    if (!zap.contextId) return null;

    if (zap.type === "repo") {
      return `/${zap.contextId}`;
    } else if (zap.type === "issue" || zap.type === "pr") {
      const [entity, repo, type, id] = zap.contextId.split("/");
      return `/${entity}/${repo}/${
        type === "issues" ? "issues" : "pulls"
      }/${id}`;
    }
    return null;
  };

  if (!mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Zaps</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Zaps</h1>
        <p className="text-gray-400">
          Please sign in to view your zap history.
        </p>
      </div>
    );
  }

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
              filter === "all"
                ? "bg-purple-600 text-white"
                : "border border-purple-500 text-purple-400"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("sent")}
            className={`px-4 py-2 rounded text-sm ${
              filter === "sent"
                ? "bg-purple-600 text-white"
                : "border border-purple-500 text-purple-400"
            }`}
          >
            Sent
          </button>
          <button
            onClick={() => setFilter("received")}
            className={`px-4 py-2 rounded text-sm ${
              filter === "received"
                ? "bg-purple-600 text-white"
                : "border border-purple-500 text-purple-400"
            }`}
          >
            Received
          </button>
        </div>
      </div>

      <div
        className="mb-6 rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-3 text-sm text-slate-300 leading-relaxed"
        role="note"
      >
        <p className="font-medium text-slate-100">What this page shows</p>
        <p className="mt-1 text-slate-400">
          <strong>LNbits-style</strong> payments (bounties, pay-to-merge, and
          similar) stay on gittr&apos;s server-side flow so status updates stay
          fast and reliable. <strong>Repository zaps</strong> to owners who
          support NIP-57 use a real zap request and show up here as{" "}
          <strong>Nostr receipts</strong> when relays deliver kind 9735. Rows
          from this browser may stay <em>pending</em> until payment is confirmed
          (for example via LNbits polling); when a matching Nostr receipt
          arrives, the duplicate pending row is hidden.
        </p>
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
      {(zaps.length > 0 || nip57Scoped.length > 0) && (
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
              <div className="text-xl font-bold theme-accent-secondary">
                {zapStats.totalPaid.toLocaleString()} sats
              </div>
              <div className="text-xs text-gray-500">{zapStats.paid} zaps</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
                <Clock className="h-4 w-4 text-yellow-400" />
                Pending
              </div>
              <div className="text-xl font-bold text-yellow-400">
                {zapStats.totalPending.toLocaleString()} sats
              </div>
              <div className="text-xs text-gray-500">
                {zapStats.pending} zaps
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
                <XCircle className="h-4 w-4 text-red-400" />
                Failed
              </div>
              <div className="text-xl font-bold text-red-400">
                {zapStats.totalFailed.toLocaleString()} sats
              </div>
              <div className="text-xs text-gray-500">
                {zapStats.failed} zaps
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Total</div>
              <div className="text-xl font-bold text-purple-400">
                {zapStats.total} zaps
              </div>
              <div className="text-xs text-gray-500">
                {(
                  zapStats.totalPaid +
                  zapStats.totalPending +
                  zapStats.totalFailed
                ).toLocaleString()}{" "}
                sats
              </div>
            </div>
          </div>

          {/* Status Filter */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "all"
                  ? "bg-purple-600 text-white"
                  : "border border-purple-500 text-purple-400"
              }`}
            >
              All ({zapStats.total})
            </button>
            <button
              onClick={() => setStatusFilter("paid")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "paid"
                  ? "theme-bg-accent-primary text-white"
                  : "border border-purple-500 text-purple-400"
              }`}
            >
              Paid ({zapStats.paid})
            </button>
            <button
              onClick={() => setStatusFilter("pending")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "pending"
                  ? "bg-yellow-600 text-white"
                  : "border border-yellow-500 text-yellow-400"
              }`}
            >
              Pending ({zapStats.pending})
            </button>
            <button
              onClick={() => setStatusFilter("failed")}
              className={`px-3 py-1 rounded text-xs ${
                statusFilter === "failed"
                  ? "bg-red-600 text-white"
                  : "border border-red-500 text-red-400"
              }`}
            >
              Failed ({zapStats.failed})
            </button>
          </div>
        </div>
      )}

      {displayZaps.length === 0 ? (
        <div className="border border-[#383B42] rounded p-8 text-center">
          <Zap className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">
            {zaps.length === 0 && nip57Scoped.length === 0
              ? "No zaps found."
              : `No ${
                  statusFilter === "all" ? "" : statusFilter + " "
                }zaps found.`}
          </p>
          {zaps.length === 0 && nip57Scoped.length === 0 && (
            <Link href="/explore">
              <button className="mt-4 px-4 py-2 border border-purple-500 text-purple-400 rounded hover:bg-purple-900/20">
                Explore Repositories
              </button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {displayZaps.map((zap) => {
            const contextLink = getZapContextLink(zap);
            const statusColor =
              zap.status === "paid"
                ? "text-green-400"
                : zap.status === "pending"
                ? "text-yellow-400"
                : "text-red-400";

            return (
              <div
                key={zap.id}
                className="border border-[#383B42] rounded p-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-4 w-4 text-purple-400" />
                      <span className="font-semibold text-purple-400">
                        {zap.amount} sats
                      </span>
                      <span className="text-gray-500">•</span>
                      <span className="text-sm text-gray-400">
                        {getZapTypeLabel(zap.type)}
                      </span>
                      {zap.source === "nip57" && (
                        <span className="text-xs rounded px-1.5 py-0.5 bg-violet-900/50 text-violet-200 border border-violet-700/60">
                          Nostr
                        </span>
                      )}
                      <span className={`text-xs ${statusColor}`}>
                        {zap.status === "paid"
                          ? "✓ Paid"
                          : zap.status === "pending"
                          ? "⏳ Pending"
                          : "✗ Failed"}
                      </span>
                    </div>
                    {zap.comment && (
                      <p className="text-sm text-gray-300 mb-1">
                        {zap.comment}
                      </p>
                    )}
                    {zap.contextId && contextLink && (
                      <Link
                        href={contextLink}
                        className="text-sm text-purple-400 hover:underline"
                      >
                        {zap.contextId}
                      </Link>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDateTime24h(zap.createdAt)}
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
