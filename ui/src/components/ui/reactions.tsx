"use client";

import { useState, useEffect, useCallback } from "react";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";

interface Reaction {
  emoji: string;
  label: string;
  count: number;
  users: string[]; // Array of pubkeys who reacted
}

interface ReactionsProps {
  targetId: string; // Issue, PR, Discussion, or Comment ID
  targetType: "issue" | "pr" | "discussion" | "comment";
  entity: string;
  repo: string;
}

const REACTION_EMOJIS = [
  { emoji: "🚀", label: "Rocket" },
  { emoji: "👍", label: "I like" },
  { emoji: "👎", label: "I dislike" },
  { emoji: "🤔", label: "I am undecided" },
];

export function Reactions({ targetId, targetType, entity, repo }: ReactionsProps) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const { isLoggedIn } = useSession();
  const [reactions, setReactions] = useState<Reaction[]>([]);

  const storageKey = `gittr_reactions__${entity}__${repo}__${targetType}__${targetId}`;

  // Load reactions from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setReactions(stored.length > 0 ? stored : REACTION_EMOJIS.map(e => ({ ...e, count: 0, users: [] })));
    } catch {
      setReactions(REACTION_EMOJIS.map(e => ({ emoji: e.emoji, label: e.label, count: 0, users: [] })));
    }
  }, [storageKey]);

  const handleReaction = useCallback((emoji: string) => {
    if (!isLoggedIn || !currentUserPubkey) return;

    setReactions(prev => {
      const updated = prev.map(reaction => {
        if (reaction.emoji === emoji) {
          const hasReacted = reaction.users.includes(currentUserPubkey);
          if (hasReacted) {
            // Remove reaction
            return {
              ...reaction,
              count: Math.max(0, reaction.count - 1),
              users: reaction.users.filter(u => u !== currentUserPubkey),
            };
          } else {
            // Add reaction
            return {
              ...reaction,
              count: reaction.count + 1,
              users: [...reaction.users, currentUserPubkey],
            };
          }
        }
        return reaction;
      });

      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
      return updated;
    });
  }, [isLoggedIn, currentUserPubkey, storageKey]);

  if (!isLoggedIn) {
    return null; // Don't show reactions if not logged in
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {reactions.map((reaction) => {
        const hasReacted = currentUserPubkey ? reaction.users.includes(currentUserPubkey) : false;
        return (
          <button
            key={reaction.emoji}
            onClick={() => handleReaction(reaction.emoji)}
            className={`
              flex items-center gap-1.5 px-2 py-1 rounded border transition-all
              ${hasReacted
                ? "bg-purple-900/50 border-purple-500 text-purple-200 hover:bg-purple-900/70"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-purple-500/50"
              }
            `}
            title={reaction.label}
          >
            <span className="text-lg">{reaction.emoji}</span>
            {reaction.count > 0 && (
              <span className="text-xs font-medium">{reaction.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

