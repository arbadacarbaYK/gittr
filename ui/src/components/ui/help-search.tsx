"use client";

import { type RefObject, useEffect, useState } from "react";

import { applyHelpSearch } from "@/lib/help/help-page-search";

import { Search, X } from "lucide-react";

export function HelpSearch({
  articleRef,
  clearRef,
}: {
  articleRef: RefObject<HTMLElement | null>;
  clearRef: RefObject<() => void>;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number | null>(null);

  useEffect(() => {
    clearRef.current = () => setQuery("");
  }, [clearRef]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const hits = applyHelpSearch(root, query);
    setMatches(query.trim() ? hits : null);
  }, [articleRef, query]);

  const trimmed = query.trim();

  return (
    <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-[#383B42] bg-[#0E1116]/95 px-6 py-3 backdrop-blur">
      <style>{`
        #help-article [data-help-hit="1"] {
          box-shadow: inset 3px 0 0 #c084fc;
        }
        #help-search::-webkit-search-cancel-button {
          display: none;
        }
      `}</style>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="sr-only" htmlFor="help-search">
          Search help
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            aria-hidden
          />
          <input
            id="help-search"
            type="search"
            name="q"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search topics and the text inside them…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                event.currentTarget.blur();
              }
            }}
            className="w-full rounded-lg border border-[#383B42] bg-[#171B21] py-3 pl-10 pr-10 text-base text-white placeholder:text-gray-500 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400/40"
          />
          {trimmed ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </form>
      <p className="mt-2 min-h-4 text-xs text-gray-500" aria-live="polite">
        {matches == null
          ? "Looks through every topic, including ones that are folded closed."
          : matches === 0
          ? "Nothing on this page matches that."
          : matches === 1
          ? "1 match"
          : `${matches} matches`}
      </p>
    </div>
  );
}
