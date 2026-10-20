"use client";

import { useEffect, useMemo, useState } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_ZAP } from "@/lib/nostr/events";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import { pickProfileDisplayName } from "@/lib/nostr/kind0-profile-fields";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import {
  type ZapRecord,
  getZapHistory,
  normalizeZapPubkey,
  zapReceipt9735ToRecord,
  zapRecordContextLabel,
  zapRecordHref,
} from "@/lib/payments/zap-tracker";
import { formatDateTime24h } from "@/lib/utils/date-format";

import { Zap } from "lucide-react";
import Link from "next/link";
import { type Event, nip19 } from "nostr-tools";

const PAGE = 8;

function personHref(pubkey: string): string {
  try {
    return `/${nip19.npubEncode(pubkey)}`;
  } catch {
    return `/${pubkey.slice(0, 8)}`;
  }
}

export function ProfileZapActivity({
  profileHex,
}: {
  profileHex: string | null | undefined;
}) {
  const hex = (profileHex || "").trim().toLowerCase();
  const enabled = /^[0-9a-f]{64}$/.test(hex);
  const { pubkey, subscribe, defaultRelays } = useNostrContext();
  const [receipts, setReceipts] = useState<ZapRecord[]>([]);
  const [localRows, setLocalRows] = useState<ZapRecord[]>([]);
  const [direction, setDirection] = useState<"received" | "sent">("received");
  const [visible, setVisible] = useState(PAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReceipts([]);
    setReady(false);
    setVisible(PAGE);
    if (!enabled || !subscribe) return;
    const collected = new Map<string, ZapRecord>();
    let eose = 0;
    const relays = getAllRelays(defaultRelays);
    const filters = [
      { kinds: [KIND_ZAP], "#p": [hex], limit: 200 },
      { kinds: [KIND_ZAP], "#P": [hex], limit: 200 },
    ];
    const unsub = subscribe(
      filters,
      relays,
      (event) => {
        const row = zapReceipt9735ToRecord(event as Event);
        if (!row) return;
        collected.set(row.id, row);
        setReceipts(Array.from(collected.values()));
      },
      undefined,
      () => {
        eose += 1;
        if (eose >= filters.length) setReady(true);
      }
    );
    const timer = window.setTimeout(() => setReady(true), 5000);
    return () => {
      window.clearTimeout(timer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, hex, subscribe, defaultRelays]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setLocalRows([]);
      return;
    }
    const mine = pubkey ? normalizeZapPubkey(pubkey) : "";
    if (mine !== hex) {
      setLocalRows([]);
      return;
    }
    setLocalRows(getZapHistory(undefined, undefined, 300));
  }, [enabled, hex, pubkey, receipts]);

  const rows = useMemo(() => {
    const merged = new Map<string, ZapRecord>();
    for (const row of receipts) merged.set(row.id, row);
    for (const row of localRows) {
      if (row.status !== "paid" || merged.has(row.id)) continue;
      const sender = row.sender ? normalizeZapPubkey(row.sender) : "";
      const recipient = normalizeZapPubkey(row.recipient);
      if (sender === hex || recipient === hex) merged.set(row.id, row);
    }
    const list = Array.from(merged.values()).filter((row) => {
      const sender = row.sender ? normalizeZapPubkey(row.sender) : "";
      const recipient = normalizeZapPubkey(row.recipient);
      if (direction === "sent") return sender === hex;
      return recipient === hex;
    });
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [receipts, localRows, direction, hex]);

  const names = useContributorMetadata(
    rows.slice(0, visible).flatMap((row) => {
      const other = direction === "sent" ? row.recipient : row.sender;
      return other ? [normalizeZapPubkey(other)] : [];
    })
  );

  if (!enabled) return null;

  const shown = rows.slice(0, visible);

  return (
    <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-300" />
          Zaps
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDirection("received");
              setVisible(PAGE);
            }}
            className={`px-3 py-1 rounded text-sm ${
              direction === "received"
                ? "bg-purple-600 text-white"
                : "border border-purple-500 text-purple-300"
            }`}
          >
            Received
          </button>
          <button
            type="button"
            onClick={() => {
              setDirection("sent");
              setVisible(PAGE);
            }}
            className={`px-3 py-1 rounded text-sm ${
              direction === "sent"
                ? "bg-purple-600 text-white"
                : "border border-purple-500 text-purple-300"
            }`}
          >
            Sent
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Tips this profile got, and tips they sent, from gittr and from other
        Nostr apps. A repo tip shows up here when the receipt points at that
        repository.
      </p>
      {!ready && rows.length === 0 ? (
        <p className="text-sm text-gray-500">Looking for zaps…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-500">
          {direction === "sent"
            ? "No zaps sent from this profile on these relays."
            : "No zaps received by this profile on these relays."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => {
            const otherRaw = direction === "sent" ? row.recipient : row.sender;
            const other = otherRaw ? normalizeZapPubkey(otherRaw) : "";
            const name =
              (other && pickProfileDisplayName(names[other])) ||
              (other ? `${other.slice(0, 8)}…` : "Someone");
            const contextHref = zapRecordHref(row);
            const contextLabel = zapRecordContextLabel(row);
            return (
              <li
                key={row.id}
                className="border border-[#383B42] rounded px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold text-amber-200">
                    {row.amount.toLocaleString()} sats
                  </span>
                  <span className="text-gray-500 text-sm">
                    {direction === "sent" ? "to" : "from"}
                  </span>
                  {other ? (
                    <Link
                      href={personHref(other)}
                      className="text-sm text-purple-300 hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-400">{name}</span>
                  )}
                  {contextHref && contextLabel ? (
                    <Link
                      href={contextHref}
                      className="text-sm text-purple-300 hover:underline"
                    >
                      {contextLabel}
                    </Link>
                  ) : null}
                </div>
                {row.comment && !contextLabel ? (
                  <p className="text-sm text-gray-300 mt-1">{row.comment}</p>
                ) : row.comment &&
                  contextLabel &&
                  row.comment.trim() !== `Zap for ${contextLabel}` &&
                  !row.comment.trim().toLowerCase().startsWith("zap for ") ? (
                  <p className="text-sm text-gray-300 mt-1">{row.comment}</p>
                ) : null}
                <p className="text-xs text-gray-500 mt-1">
                  {formatDateTime24h(row.createdAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > visible ? (
        <button
          type="button"
          className="mt-3 text-sm text-purple-300 hover:underline"
          onClick={() => setVisible((n) => n + PAGE)}
        >
          Show more
        </button>
      ) : null}
    </div>
  );
}
