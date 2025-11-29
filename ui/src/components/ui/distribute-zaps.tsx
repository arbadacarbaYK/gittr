"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Loader2 } from "lucide-react";

interface Contributor {
  pubkey?: string;
  name?: string;
  picture?: string;
  weight: number;
  githubLogin?: string;
}

interface DistributeZapsProps {
  entity: string;
  repo: string;
  contributors?: Contributor[];
}

export default function DistributeZaps({ entity, repo, contributors = [] }: DistributeZapsProps) {
  const [mode, setMode] = useState<"sats" | "percent">("sats");
  const [feeMode, setFeeMode] = useState<"gross" | "cap">("gross");
  const [rows, setRows] = useState<Array<{ pubkey?: string; lud16?: string; lnurl?: string; name: string; enabled: boolean; amount: number }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Array<{ name: string; status: string; error?: string }>>([]);

  // Get nostr metadata for contributors
  const pubkeys = useMemo(() => contributors.map(c => c.pubkey).filter((p): p is string => !!p), [contributors]);
  const meta = useContributorMetadata(pubkeys);

  // Prepare rows
  useEffect(() => {
    const initial = contributors.map(c => {
      const m = c.pubkey ? meta[c.pubkey] : undefined;
      const name = (m?.display_name || m?.name || c.name || c.pubkey?.slice(0, 8) || "contrib");
      const lud16 = m?.lud16;
      const lnurl = m?.lnurl;
      return {
        pubkey: c.pubkey,
        name,
        lud16,
        lnurl,
        enabled: !!(lud16 || lnurl),
        amount: 0,
      };
    });
    setRows(initial);
  }, [contributors, meta]);

  const totalAmount = useMemo(() => rows.reduce((sum, r) => sum + (r.enabled ? r.amount : 0), 0), [rows]);
  const percentSum = useMemo(() => rows.reduce((sum, r) => sum + (r.enabled ? r.amount : 0), 0), [rows]);

  function setRowAmount(idx: number, value: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: Math.max(0, Math.floor(value || 0)) } : r));
  }

  async function distribute() {
    setSubmitting(true);
    setResult([]);
    try {
      const lnbitsUrl = localStorage.getItem("gittr_lnbits_url") || "";
      const lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key") || "";
      if (!lnbitsUrl || !lnbitsAdminKey) {
        setResult([{ name: "Config", status: "error", error: "LNbits not configured in Settings → Account" }]);
        setSubmitting(false);
        return;
      }

      // Build recipients
      let recipients: Array<{ lud16?: string; lnurl?: string; amount: number; comment?: string }> = [];
      if (mode === "sats") {
        recipients = rows.filter(r => r.enabled && (r.lud16 || r.lnurl) && r.amount > 0).map(r => ({ lud16: r.lud16, lnurl: r.lnurl, amount: r.amount, comment: `${entity}/${repo} distribution` }));
      } else {
        // percent mode - require sum 100
        const sum = rows.filter(r => r.enabled).reduce((s, r) => s + r.amount, 0);
        if (sum !== 100) {
          setResult([{ name: "Validation", status: "error", error: "Percent splits must sum to 100" }]);
          setSubmitting(false);
          return;
        }
        const cap = parseInt(prompt("Total sats to distribute (fees included if 'cap', else fees on top)") || "0");
        if (!cap || cap <= 0) {
          setSubmitting(false);
          return;
        }
        recipients = rows.filter(r => r.enabled && (r.lud16 || r.lnurl) && r.amount > 0).map(r => ({ lud16: r.lud16, lnurl: r.lnurl, amount: Math.floor((cap * r.amount) / 100), comment: `${entity}/${repo} distribution` }));
      }

      const resp = await fetch("/api/zap/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, feeMode, lnbitsUrl, lnbitsAdminKey }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setResult([{ name: "Distribute", status: "error", error: data.error || "failed" }]);
      } else {
        const rs = (data.results || []).map((r: any, idx: number) => ({ name: rows[idx]?.name || `#${idx + 1}`, status: r.status, error: r.error }));
        setResult(rs);
      }
    } catch (e: any) {
      setResult([{ name: "Distribute", status: "error", error: e.message }]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6">
      <h4 className="font-semibold mb-2">Distribute zaps</h4>
      <div className="flex items-center gap-3 text-sm mb-3">
        <label className="flex items-center gap-1">
          <input type="radio" id="distribute-mode-sats" name="distribute-mode" checked={mode === "sats"} onChange={() => setMode("sats")} />
          Sats
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" id="distribute-mode-percent" name="distribute-mode" checked={mode === "percent"} onChange={() => setMode("percent")} />
          Percent
        </label>
        <span className="mx-2">|</span>
        <label className="flex items-center gap-1">
          <input type="radio" id="distribute-fee-gross" name="distribute-fee" checked={feeMode === "gross"} onChange={() => setFeeMode("gross")} />
          Fees on top
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" id="distribute-fee-cap" name="distribute-fee" checked={feeMode === "cap"} onChange={() => setFeeMode("cap")} />
          Cap spend
        </label>
      </div>

      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className={`flex items-center gap-3 p-2 border rounded ${r.enabled ? "border-gray-700" : "border-gray-800 bg-gray-900/30"}`}>
            <label className="flex items-center gap-2 w-1/3" htmlFor={`distribute-checkbox-${idx}`}>
              <input type="checkbox" id={`distribute-checkbox-${idx}`} name={`distribute-enabled-${idx}`} checked={r.enabled} onChange={(e) => setRows(prev => prev.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))} disabled={!r.lud16 && !r.lnurl} />
              <span className="truncate" title={r.name}>{r.name}</span>
              {!r.lud16 && !r.lnurl && (<Badge className="ml-2">no lightning</Badge>)}
            </label>
            <input
              type="number"
              id={`distribute-amount-${idx}`}
              name={`distribute-amount-${idx}`}
              min={0}
              className="w-32 px-2 py-1 border border-gray-700 bg-gray-800 text-white rounded"
              value={r.amount}
              onChange={(e) => setRowAmount(idx, parseInt(e.target.value || "0"))}
              placeholder={mode === "sats" ? "sats" : "%"}
              disabled={!r.enabled}
            />
            <span className="text-xs text-gray-500">{mode === "sats" ? "sats" : "%"}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 text-sm text-gray-400">
        {mode === "sats" ? (
          <span>Total: {totalAmount} sats (fees {feeMode === "gross" ? "on top" : "included"})</span>
        ) : (
          <span>Percent sum: {percentSum}%</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={distribute} disabled={submitting}>
          {submitting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Distributing...</>) : "Distribute now"}
        </Button>
      </div>

      {result.length > 0 && (
        <div className="mt-3 space-y-1 text-sm">
          {result.map((r, i) => (
            <div key={i} className={`p-2 border rounded ${r.status === "ok" ? "border-green-700 bg-green-900/20" : r.status === "failed" ? "border-red-700 bg-red-900/20" : "border-gray-700 bg-gray-900/20"}`}>
              <span className="font-semibold mr-2">{r.name}</span>
              <span>{r.status}</span>
              {r.error && <span className="ml-2 text-red-400">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
